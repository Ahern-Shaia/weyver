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

export function formatDateTime(
  value: unknown,
  opts: { timeZone?: string | undefined; locale?: string | undefined; withTime?: boolean } = {},
): string {
  const raw = typeof value === "string" || value instanceof Date ? value : String(value)
  const d = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(d.getTime())) return String(value)
  const { timeZone, locale = "zh-TW", withTime = true } = opts
  return (
    new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false } : {}),
      ...(timeZone === undefined ? {} : { timeZone }),
    })
      .format(d)
      /* zh-TW 的預設分隔是 `2026/07/19` —— 保留,但把時間段的分隔統一為冒號 */
      .replace(/ /g, " ")
  )
}

/* 顯示用的單一入口。**型別驅動**,不靠值的長相猜 ——
   猜的話「看起來像日期的字串」與「真的日期欄」會走到不同分支,而那正是不一致的來源。 */
export function displayValue(
  field: Pick<FieldDto, "type" | "options">,
  value: unknown,
  ctx: { timeZone?: string | undefined; locale?: string | undefined } = {},
): string {
  if (value === null || value === undefined || value === "") return "—"
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join("、") : "—"
  if (typeof value === "boolean") return value ? "是" : "否"

  switch (field.type) {
    case "money":
      return formatMoney(value, currencyOf(field), ctx.locale)
    case "percent": {
      const n = Number(value)
      return Number.isFinite(n) ? `${formatNumber(n, ctx.locale)}%` : String(value)
    }
    case "date":
      return formatDateTime(value, { ...ctx, withTime: false })
    /* 🔴 `createdAt` / `updatedAt` 是**系統時間欄**,型別名與 `dateTime` 不同,
       但顯示需求一樣。初版漏了它們 —— 瀏覽器實走時「建立時間」仍印出
       `2026-07-19T05:45:02.592Z`,而單元測試全綠(測試裡沒有這兩個型別)。
       型別驅動的代價就是**漏列一個型別 = 那個型別完全沒被處理**,
       而它不會以錯誤的形式出現,只會安靜地退回 String()。 */
    case "dateTime":
    case "createdAt":
    case "updatedAt":
      return formatDateTime(value, ctx)
    default:
      if (NUMERIC_TYPES.has(field.type)) return formatNumber(value, ctx.locale)
      return String(value)
  }
}

export const isNumericField = (type: string): boolean => NUMERIC_TYPES.has(type)
