import { ConsoleLogger, type LoggerService } from "@nestjs/common"

/* 🔴 A-1 FMEA C1 / 殘留 R1|日誌遮蔽。

   ## 這一層防的不是現在,是以後

   M6 逐條查證後確認:**目前沒有任何路徑**把憑證寫進 log
   (SSRF 錯誤只回主機名、`send()` 的失敗訊息不含 secret、DB 的 `last_error`
   存的是對方的回應)。但當時也沒有**任何機制**阻止未來新增這種路徑,
   而最危險的具體形狀是 —— **Telegram 的 bot token 位在 URL 路徑裡**,
   任何「把 URL 寫進 log」的新程式碼都會外洩它。

   OWASP Logging Cheat Sheet 的**禁記清單**逐字含「Session identification values」
   「Access tokens」「Authentication passwords」「Database connection strings」
   「Encryption keys and other primary secrets」。

   ## 為什麼是自訂 logger 而不是換 pino

   AGENTS 規劃的是 nestjs-pino + `redact`,但那是**換掉整套日誌堆疊** ——
   輸出格式、關聯 ID、既有的 `Logger` 呼叫全都受影響,blast radius 遠大於這件事本身。
   這一層只做一件事:在訊息離開程序**之前**掃一遍。日後接 pino 時,
   把 `SECRET_KEYS` 與 `VALUE_PATTERNS` 搬進 `redact` 設定即可,判斷邏輯不必重寫。

   ## 兩種遮法

   · **鍵名**|物件裡叫 password / token / secret… 的欄位,值一律換成 `[已遮蔽]`。
   · **值的形狀**|字串裡長得像憑證的片段(Telegram 的 `/bot<token>/`、
     我方的信封密文 `v1.…`、`Bearer …`、Slack webhook 路徑)就地替換。
     鍵名遮不到「有人把整個 URL 串進訊息裡」這種情況,故兩者都要。 */

const SECRET_KEYS = [
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "accesstoken",
  "secret",
  "secretsealed",
  "authorization",
  "cookie",
  "apikey",
  "kek",
  "privatekey",
  "connectionstring",
] as const

export const MASK = "[已遮蔽]"

/* 值的形狀。**順序有意義** —— 先遮較長的 pattern,免得短的先切斷長的。 */
const VALUE_PATTERNS: readonly RegExp[] = [
  /* Telegram:token 在路徑裡,是本專案最具體的外洩形狀 */
  /\/bot[A-Za-z0-9:_-]{10,}\//g,
  /* 我方信封加密的密文(v1.<kekId>.<…>) */
  /\bv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16,}[A-Za-z0-9._-]*/g,
  /* Slack / Teams / Discord 的 incoming webhook 路徑 */
  /(hooks\.slack\.com|discord\.com\/api\/webhooks|outlook\.office(365)?\.com)\/\S+/gi,
  /* Authorization header 的值 */
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /* 連線字串裡的密碼 */
  /(postgres(ql)?:\/\/[^:\s]+):[^@\s]+@/gi,
]

function redactString(text: string): string {
  let out = text
  for (const p of VALUE_PATTERNS) {
    out = out.replace(p, (match) => {
      /* 連線字串保留 scheme 與帳號,只遮密碼 —— 全遮會讓「連哪台」也查不出來 */
      const conn = /^(postgres(ql)?:\/\/[^:\s]+):/i.exec(match)
      if (conn !== null) return `${conn[1] ?? ""}:${MASK}@`
      return MASK
    })
  }
  return out
}

const isSecretKey = (key: string): boolean =>
  SECRET_KEYS.includes(key.toLowerCase().replace(/[_-]/g, "") as (typeof SECRET_KEYS)[number])

/* 深層遮蔽。**有循環參照保護** —— log 一個帶循環的物件不該讓程序爆掉。 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return "[循環參照]"
  seen.add(value)

  if (Array.isArray(value)) return value.map((v) => redact(v, seen))

  /* Error 的 message / stack 也要過一遍 —— 例外訊息是最常夾帶 URL 的地方 */
  if (value instanceof Error) {
    return `${value.name}: ${redactString(value.message)}`
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSecretKey(k) ? MASK : redact(v, seen)
  }
  return out
}

/* 全域 logger:每一則訊息離開程序之前都過一遍遮蔽。
   繼承 ConsoleLogger 而非重寫輸出 —— 格式、色彩、context 前綴全部維持原樣。 */
export class RedactingLogger extends ConsoleLogger implements LoggerService {
  override log(message: unknown, ...rest: unknown[]): void {
    super.log(redact(message), ...rest.map((r) => redact(r)))
  }
  override error(message: unknown, ...rest: unknown[]): void {
    super.error(redact(message), ...rest.map((r) => redact(r)))
  }
  override warn(message: unknown, ...rest: unknown[]): void {
    super.warn(redact(message), ...rest.map((r) => redact(r)))
  }
  override debug(message: unknown, ...rest: unknown[]): void {
    super.debug(redact(message), ...rest.map((r) => redact(r)))
  }
  override verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(redact(message), ...rest.map((r) => redact(r)))
  }
}
