import dns from "node:dns/promises"
import net from "node:net"
import https from "node:https"
import { DomainError } from "../form-engine/errors.js"

/* 🔴 G-1 M2|SSRF 防護。**使用者填的 URL** 是 docs/22 威脅前三之一。

   ## 為什麼不能只做「解析 → 驗證 IP → fetch」

   Node 原生 fetch = undici,而 **undici 在連線時會自己重新解析 DNS**。
   驗證與連線之間因此有一個 TOCTOU 空窗,攻擊者用 DNS rebinding
   (第一次回公網 IP 通過驗證,第二次回 169.254.169.254)即可繞過。
   這不是理論:Budibase **CVE-2026-54353 / GHSA-v42f-v8xc-j435**、
   MCP-Atlassian **CVE-2026-27826** 都是這樣被打穿的。

   ## 修法:把解析權拿回來

   自己解析 → 驗證每一個回傳的 IP → 用 `connect.lookup` **餵回那個已驗證的 IP**。
   undici 不再碰系統 DNS,空窗**結構上不存在**,不是靠時間差賭贏。

   本機實測(Node v24.14.0):`connect.lookup` 確實被呼叫、且是唯一解析路徑
   (不帶 lookup 時走系統 DNS,本機解析不到即 `fetch failed`)。

   ## 其餘三道

   - **HTTPS-only**(Stripe live mode 同做法)
   - **`redirect: "error"`** —— Stripe 明載把 3xx 視為投遞失敗。實測會擲出
     `unexpected redirect`。零功能損失砍掉「先回公網 302 再跳內網」整類繞過。
   - **無開關**。n8n 有完整 SSRF 服務卻**預設 `enabled: false`**(issue #28035)
     —— 預設關等於沒有。本模組不提供停用選項。 */

/* 🔴 必須繼承 `DomainError`,否則不會被全域 filter 映射。
   瀏覽器實走抓到:原本繼承 `Error` → 落到 500「internal error」,
   使用者填了內網位址只看到一句無意義的錯誤,不知道自己踩到什麼。
   **擋下來不等於做完了 —— 擋下的理由要說得出來。** */
export class SsrfBlockedError extends DomainError {
  constructor(readonly reason: string) {
    super(`目標位址不被允許:${reason}`)
  }
}

/* 私有 / 保留 / 內部用途網段。IPv4-mapped IPv6(::ffff:10.0.0.1)必須先正規化再判,
   否則 `10/8` 這條會被繞過。 */
const V4_BLOCKED: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local:含 AWS/GCP/Azure metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // 多播
  ["240.0.0.0", 4], // 保留 + 廣播
]

function v4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number)
  return (
    (((parts[0] ?? 0) << 24) >>> 0) |
    ((parts[1] ?? 0) << 16) |
    ((parts[2] ?? 0) << 8) |
    (parts[3] ?? 0)
  )
}

function inV4Cidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask)
}

/* `::ffff:a.b.c.d` 與 `::ffff:0a00:0001` 都是 IPv4-mapped。取出內嵌的 v4。 */
function unmapV4(ip: string): string | null {
  const lower = ip.toLowerCase()
  if (!lower.startsWith("::ffff:")) return null
  const tail = lower.slice(7)
  if (net.isIPv4(tail)) return tail
  const hex = tail.split(":")
  if (hex.length !== 2) return null
  const [hi, lo] = [Number.parseInt(hex[0] ?? "", 16), Number.parseInt(hex[1] ?? "", 16)]
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null
  return `${String(hi >> 8)}.${String(hi & 0xff)}.${String(lo >> 8)}.${String(lo & 0xff)}`
}

export function isBlockedAddress(raw: string): string | null {
  const mapped = unmapV4(raw)
  const ip = mapped ?? raw

  if (net.isIPv4(ip)) {
    for (const [base, bits] of V4_BLOCKED) {
      if (inV4Cidr(ip, base, bits)) return `私有或保留位址 ${ip}`
    }
    return null
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    if (lower === "::" || lower === "::1") return `本機位址 ${ip}`
    /* 🔴 不可用 `split(":")[0]` 取首段 —— `::` 壓縮開頭時它是空字串,
       parseInt 得到 NaN。原本那樣寫會把所有以 `::` 開頭的 IPv6 一律誤擋
       (fail-closed 不算漏洞,但公網位址也連不出去),而且會讓
       mapped 位址的測試「因為 NaN 而通過」,掩蓋掉正規化到底有沒有生效。 */
    const hextets = expandV6(lower)
    if (hextets === null) return `無法解析的 IPv6 ${ip}`
    const head = hextets[0] ?? 0
    if ((head & 0xfe00) === 0xfc00) return `唯一本地位址 ${ip}` // fc00::/7
    if ((head & 0xffc0) === 0xfe80) return `連結本地位址 ${ip}` // fe80::/10
    if ((head & 0xff00) === 0xff00) return `多播位址 ${ip}` // ff00::/8
    return null
  }
  return `不是有效的 IP:${raw}`
}

/* 展開成 8 個 hextet(處理 `::` 壓縮與尾端內嵌的 IPv4)。 */
function expandV6(lower: string): number[] | null {
  const [headPart = "", tailPart] = lower.split("::") as [string?, string?]
  const toHextets = (part: string): number[] | null => {
    if (part === "") return []
    const out: number[] = []
    for (const seg of part.split(":")) {
      if (net.isIPv4(seg)) {
        const o = seg.split(".").map(Number)
        out.push(((o[0] ?? 0) << 8) | (o[1] ?? 0), ((o[2] ?? 0) << 8) | (o[3] ?? 0))
        continue
      }
      const n = Number.parseInt(seg, 16)
      if (Number.isNaN(n)) return null
      out.push(n)
    }
    return out
  }
  const head = toHextets(headPart)
  const tail = tailPart === undefined ? [] : toHextets(tailPart)
  if (head === null || tail === null) return null
  if (tailPart === undefined) return head.length === 8 ? head : null
  const fill = 8 - head.length - tail.length
  if (fill < 0) return null
  return [...head, ...Array.from({ length: fill }, () => 0), ...tail]
}

export interface SafeTarget {
  readonly url: URL
  readonly address: string
  readonly family: 4 | 6
}

/* WHATWG URL 解析(OWASP:禁用 regex 判 URL)+ scheme 白名單 + 解析後全 IP 檢查。
 **回傳已驗證的那個 IP**,呼叫端必須把它 pin 進 dispatcher。 */
export async function resolveSafeTarget(rawUrl: string): Promise<SafeTarget> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError("URL 格式無效")
  }
  if (url.protocol !== "https:") {
    throw new SsrfBlockedError("只允許 https(避免明文外送與中間人竄改)")
  }
  if (url.username !== "" || url.password !== "") {
    throw new SsrfBlockedError("URL 不得內嵌帳密")
  }

  const host = url.hostname.replace(/^\[|\]$/g, "")
  let addresses: { address: string; family: number }[]
  if (net.isIP(host) !== 0) {
    addresses = [{ address: host, family: net.isIPv6(host) ? 6 : 4 }]
  } else {
    try {
      addresses = await dns.lookup(host, { all: true })
    } catch {
      throw new SsrfBlockedError(`無法解析主機名 ${host}`)
    }
  }
  if (addresses.length === 0) throw new SsrfBlockedError(`主機名 ${host} 沒有解析結果`)

  /* 🔴 **全部**解析結果都要過關,不是取第一個。
     多筆 A 記錄中夾一筆內網 IP 是常見手法,只驗第一筆等於沒驗。 */
  for (const a of addresses) {
    const blocked = isBlockedAddress(a.address)
    if (blocked !== null) throw new SsrfBlockedError(blocked)
  }
  const chosen = addresses[0]
  if (chosen === undefined) throw new SsrfBlockedError("沒有可用位址")
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 }
}

/* 把已驗證的 IP pin 死:Agent 拿到自訂 `lookup` 後就不再碰系統 DNS,
   驗證與連線之間的空窗**結構上不存在**,不是靠時間差賭贏。

   用 `node:https` 而非 undici:本機實測兩者的 lookup 都有效,但內建版
   **零新依賴**、無 undici 型別與 Node 內建 undici-types 的版本衝突,
   且 `https.request` 預設就**不跟隨 3xx**(原樣回傳,由呼叫端判定為失敗)。 */
export function pinnedAgent(target: SafeTarget, timeoutMs: number): https.Agent {
  return new https.Agent({
    keepAlive: false,
    timeout: timeoutMs,
    minVersion: "TLSv1.2",
    lookup: (_hostname, _options, callback) => {
      // Node 24 走 lookupAndConnectMultiple → callback 需回陣列
      ;(callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address: target.address, family: target.family },
      ])
    },
  })
}

/* GitLab CVE-2025-6454:webhook 的**自訂 header 值也是注入面**。
   CR/LF 會被用來拆分請求;控制字元一律拒。 */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "authorization",
  "webhook-id",
  "webhook-timestamp",
  "webhook-signature",
])

/* 逐字元判而非正則:Biome 的 noControlCharactersInRegex 會擋含控制字元的 regex,
   而這裡要擋的**正是**控制字元。用碼點比較更直白也免去 lint 例外。 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function assertSafeHeaders(headers: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(name)) throw new SsrfBlockedError(`header 名稱不合法:${name}`)
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new SsrfBlockedError(`不得覆寫保留 header:${name}`)
    }
    if (hasControlChar(value)) {
      throw new SsrfBlockedError(`header ${name} 的值含控制字元`)
    }
  }
}
