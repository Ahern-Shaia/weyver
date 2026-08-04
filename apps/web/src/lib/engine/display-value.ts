/* 🔴 欄位值的**顯示**格式化。

   ## 為什麼需要這一支

   原本各處都是 `String(v)`,於是畫面上直接出現:
   · 金額 `128400.0000`(引擎存 `numeric(19,4)`,邊界收十進位字串 —— 鐵則 2)
   · 時間 `2026-07-19T05:45:02.592Z`(原始 ISO,含毫秒與 Z)

   docs/14 把**時間戳與金額**列為信任訊號:它們的作用是讓使用者相信這份資料是真的、
   而且是這個時間點的。原樣印出資料庫的內部表示,效果**恰好相反** —— 看起來像沒做完。

   ## 為什麼小數位問「Intl」而不是自己列表

   `docs/18 §0`:金額每幣別小數位 + 明確捨入。這份對照表已經在 ICU / CLDR 裡,
   自己再抄一份只會抄錯或過期 —— **本檔初版的註解就憑印象寫成「TWD 慣例 0 位」,
   而 ICU 給的是 2 位,被測試當場打臉**。故一律以 `Intl` 反查,不硬編。
   (JPY 確實是 0 位,機制本身沒問題,錯的是憑印象的那份表。)

   ## 顯示時區

   時間一律以**使用者的顯示時區**呈現(個人設定,見 `useUserSettings`)。
   ⚠️ 這**只影響顯示** —— 單號日期段與各項期間仍以公司的業務時區為準(docs/14 已釐清)。 */

import type { FieldDto } from "./schemas"

const NUMERIC_TYPES = new Set(["money", "number", "percent", "rating", "formula", "rollup"])

/* 幣別的標準小數位由 ICU 供給(TWD 2 / USD 2 / JPY 0)。 */
function currencyFractionDigits(currency: string): number {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    return parts.maximumFractionDigits ?? 2
  } catch {
    /* 未知幣別代碼(客戶自填)→ 退回 2 位,是最不會出錯的預設 */
    return 2
  }
}

function currencyOf(field: Pick<FieldDto, "options">): string {
  const raw = (field.options as { currency?: unknown } | undefined)?.currency
  return typeof raw === "string" && raw.length === 3 ? raw.toUpperCase() : "TWD"
}

export function formatMoney(value: unknown, currency: string, locale = "zh-TW"): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return String(value)
  const d = currencyFractionDigits(currency)
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n)
}

/* 一般數字:加千分位,但**不強制小數位** —— 數量 320 不該變成 320.00。 */
export function formatNumber(value: unknown, locale = "zh-TW"): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return String(value)
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n)
}

/* 🔴 R1·FMT M2|日期格式是**欄位的屬性**,不是瀏覽器或租戶語系的屬性。

   一手依據(§0.3):Ragic 把格式放在「設計模式 › 欄位設定 › 基本」;
   Airtable 放在欄位的「Date format」,且明說預設跟瀏覽器走、**要改得去改瀏覽器設定** ——
   它把「跟著環境」降級成其中一個選項(`Local`),而不是唯一行為。

   ⚠️ 為什麼這件事必要:`local` 之下,格式由使用者/租戶的 `locale` 決定,
   而 `en` 是設定白名單裡的合法值 —— 一個租戶選了它,整個產品的日期就變成美式。
   那正是 #155 回報的症狀,只是成因不是瀏覽器而是設定。**設計者必須能指定。**

   白名單而非格式碼:兩者相容方向是單向的 —— 白名單日後可映射成 pattern,
   但一旦開放任意字串就收不回來(會動到客戶已存的資料)。先窄後寬。
   民國年(P1,`field-types-parity` OQ-FTP-7 已裁定)屆時加 key 即可,不必改模型。 */
export const DATE_FORMATS = ["local", "iso", "slash", "dash", "dot"] as const
export type DateFormatKey = (typeof DATE_FORMATS)[number]

export const DATE_FORMAT_LABEL: Record<DateFormatKey, string> = {
  local: "依語系",
  iso: "2026-03-05",
  slash: "2026/03/05",
  dash: "05-03-2026",
  dot: "2026.03.05",
}

function dateFormatOf(field: Pick<FieldDto, "options">): DateFormatKey {
  const raw = (field.options as { dateFormat?: unknown } | undefined)?.dateFormat
  return typeof raw === "string" && (DATE_FORMATS as readonly string[]).includes(raw)
    ? (raw as DateFormatKey)
    : "local"
}

/* 取指定時區下的年月日。**不可用 `d.getFullYear()`** —— 那是執行環境的時區,
   會讓同一筆資料在不同機器上跨日(專案已為 pg DATE parser 踩過一次位移 bug)。 */
function partsIn(d: Date, timeZone: string | undefined): { y: string; m: string; day: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).formatToParts(d)
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? ""
  return { y: get("year"), m: get("month"), day: get("day") }
}

function timeIn(d: Date, timeZone: string | undefined, withSeconds: boolean): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(d)
}

export function formatDateTime(
  value: unknown,
  opts: {
    timeZone?: string | undefined
    locale?: string | undefined
    withTime?: boolean
    format?: DateFormatKey
  } = {},
): string {
  const raw = typeof value === "string" || value instanceof Date ? value : String(value)
  const d = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(d.getTime())) return String(value)
  const { timeZone, locale = "zh-TW", withTime = true, format = "local" } = opts

  if (format !== "local") {
    const { y, m, day } = partsIn(d, timeZone)
    const datePart =
      format === "iso"
        ? `${y}-${m}-${day}`
        : format === "slash"
          ? `${y}/${m}/${day}`
          : format === "dash"
            ? `${day}-${m}-${y}`
            : `${y}.${m}.${day}`
    return withTime ? `${datePart} ${timeIn(d, timeZone, true)}` : datePart
  }

  return (
    new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false } : {}),
      ...(timeZone === undefined ? {} : { timeZone }),
    })
      .format(d)
      /* 🔴 ICU 在日期與時間之間放的是**窄空白**,不是一般空白。
         看不出來,但會讓 e2e 的文字比對、複製到 Excel、匯出比對全部失準。

         ⚠️ 原本這行寫死 `\u202f`(narrow no-break space),
         而現行 ICU 實測送的是 `\u2009`(thin space)—— **那行早已是 no-op**,
         只是沒有任何東西會告訴你。ICU 改過一次就會再改,
         故改為歸一化**所有** Unicode 空白分隔符,不追定哪一個碼位。 */
      .replace(/\p{Zs}/gu, " ")
  )
}

/* 顯示用的單一入口。**型別驅動**,不靠值的長相猜 ——
   猜的話「看起來像日期的字串」與「真的日期欄」會走到不同分支,而那正是不一致的來源。 */
function applyMask(raw: string, mask: string): string {
  let i = 0
  let out = ""
  for (const ch of mask) {
    if (ch !== "#") {
      out += ch
      continue
    }
    if (i >= raw.length) return out
    out += raw[i]
    i += 1
  }
  return i < raw.length ? out + raw.slice(i) : out
}

export function displayValue(
  field: Pick<FieldDto, "type" | "options">,
  value: unknown,
  ctx: { timeZone?: string | undefined; locale?: string | undefined } = {},
): string {
  if (value === null || value === undefined || value === "") return "—"
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join("、") : "—"
  if (typeof value === "boolean") return value ? "是" : "否"

  switch (field.type) {
    /* 🔴 audit-D §2.4|格式遮罩。`###-##-####` 之類的樣板,`#` 為值的下一個字元,
       其餘字元原樣插入。**儲存的仍是原值**(模組 §4.5 逐字:前端顯示格式化)。

       ⚠️ 這個 option 從 M3 出貨以來**只有 schema**:設計器沒有入口、渲染端沒有分支
       —— 打 API 設了也不會有任何效果。值比樣板長時**把剩下的接在後面**,
       不截斷:截斷等於在畫面上偽造資料。 */
    case "text": {
      const mask = (field.options as { displayMask?: unknown } | null)?.displayMask
      if (typeof mask !== "string" || mask === "") return String(value)
      return applyMask(String(value), mask)
    }
    case "money":
      return formatMoney(value, currencyOf(field), ctx.locale)
    case "percent": {
      const n = Number(value)
      return Number.isFinite(n) ? `${formatNumber(n, ctx.locale)}%` : String(value)
    }
    case "date":
      return formatDateTime(value, { ...ctx, withTime: false, format: dateFormatOf(field) })
    /* 🔴 `createdAt` / `updatedAt` 是**系統時間欄**,型別名與 `dateTime` 不同,
       但顯示需求一樣。初版漏了它們 —— 瀏覽器實走時「建立時間」仍印出
       `2026-07-19T05:45:02.592Z`,而單元測試全綠(測試裡沒有這兩個型別)。
       型別驅動的代價就是**漏列一個型別 = 那個型別完全沒被處理**,
       而它不會以錯誤的形式出現,只會安靜地退回 String()。 */
    case "dateTime":
      return formatDateTime(value, { ...ctx, format: dateFormatOf(field) })
    /* 系統時間欄**不吃欄位格式** —— 它們不是使用者設計的欄位,沒有欄位設定可改 */
    case "createdAt":
    case "updatedAt":
      return formatDateTime(value, ctx)
    default:
      if (NUMERIC_TYPES.has(field.type)) return formatNumber(value, ctx.locale)
      return String(value)
  }
}

export const isNumericField = (type: string): boolean => NUMERIC_TYPES.has(type)
