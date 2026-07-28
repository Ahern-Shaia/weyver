import type { CellValueType } from "@/lib/engine/schemas"

/* 純 Excel 匯入核心(無 SheetJS / JSX,可單元測):型別推斷 heuristic + 逐列值轉換。
   推斷為輔助,使用者於預覽可覆寫;信心邊界一律保守 fallback text(可改不可壞;docs A4)。 */

const SAMPLE_LIMIT = 50

const BOOL_TRUE = new Set(["true", "是", "y", "yes", "1", "v", "✓"])
const BOOL_FALSE = new Set(["false", "否", "n", "no", "0", "x"])

const NUMBER_RE = /^-?[\d,]+(\.\d+)?$/
const MONEY_RE = /^[$¥€£NT\s]*-?[\d,]+(\.\d{1,4})?[$¥€£\s]*$/i
const MONEY_SIGNAL_RE = /[$¥€£]|NT\$/i
const DATE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/
const DATETIME_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?/

function nonEmpty(values: readonly string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v !== "")
}

function allMatch(samples: readonly string[], test: (v: string) => boolean): boolean {
  return samples.length > 0 && samples.every(test)
}

function isBooleanish(v: string): boolean {
  const lower = v.toLowerCase()
  return BOOL_TRUE.has(lower) || BOOL_FALSE.has(lower)
}

/* 🔴 一票否決:看起來像數字、但**數值化即損毀語意**的識別碼。

   實測(追溯稽核)|原本 `NUMBER_RE` 讓這些全判成 number,經 `Number()` 後:
   - `00123`(郵遞區號 / 舊料號)→ `123`,**前導零永久消失**
   - `0912345678`(台灣手機)→ `912345678`,**前導零永久消失**
   - 15 位以上純數字 → 超過 `MAX_SAFE_INTEGER`,**精度損毀**

   這不是「推斷保守與否」的取捨,是**匯入即毀資料**。客戶手上的舊 Excel
   幾乎必有電話 / 統編 / 郵遞區號欄,是 onboarding 的第一線。

   例外:欄名明示為量值時仍允許數字(否則「數量」欄的 8 位數會被誤擋)。 */
const LEADING_ZERO_RE = /^0\d/
const OVER_PRECISION_RE = /^-?\d{15,}$/
/* 8–14 位純數字:統編 8 / 身分證 10 / 手機 10 / 市話含區碼 —— 除非欄名是量值 */
const IDENTIFIER_LEN_RE = /^\d{8,14}$/
const PHONE_PUNCT_RE = /^[+(]|[\d)]-[\d(]/
const QUANTITY_NAME_RE = /數量|金額|單價|價格|重量|人數|件數|qty|amount|price|cost|weight|total/i

function looksLikeIdentifier(v: string, columnName: string): boolean {
  if (LEADING_ZERO_RE.test(v)) return true
  if (OVER_PRECISION_RE.test(v)) return true
  if (PHONE_PUNCT_RE.test(v)) return true
  if (IDENTIFIER_LEN_RE.test(v) && !QUANTITY_NAME_RE.test(columnName)) return true
  return false
}

function isNumberish(v: string): boolean {
  return NUMBER_RE.test(v)
}

function isMoneyish(v: string): boolean {
  if (!MONEY_RE.test(v)) return false
  // 純整數(無小數、無貨幣符號)不算金額,交給 number
  return MONEY_SIGNAL_RE.test(v) || /\.\d{2}$/.test(v)
}

export interface InferredColumn {
  readonly type: CellValueType
  readonly choices?: readonly string[]
}

export function inferColumnType(
  rawValues: readonly string[],
  rowCount: number,
  columnName = "",
): InferredColumn {
  const samples = nonEmpty(rawValues).slice(0, SAMPLE_LIMIT)
  if (samples.length === 0) return { type: "text" }

  if (allMatch(samples, isBooleanish)) return { type: "checkbox" }
  /* 日期先判 —— 其形狀明確,且 `2026-07-22` 會誤中下方的電話分隔規則 */
  if (allMatch(samples, (v) => DATETIME_RE.test(v))) return { type: "dateTime" }
  if (allMatch(samples, (v) => DATE_RE.test(v))) return { type: "date" }

  /* 一票否決:只與 money / number 競爭 —— 有任一格像識別碼,整欄退 text。
     寧可讓使用者手動改成數字(可改),也不能讓前導零消失(不可逆)。 */
  if (samples.some((v) => looksLikeIdentifier(v, columnName))) return { type: "text" }

  if (allMatch(samples, isMoneyish)) return { type: "money" }
  if (allMatch(samples, isNumberish)) return { type: "number" }

  // 低基數 → singleSelect(相異值為 choices);列數足夠才判,避免小樣本誤判
  const distinct = [...new Set(samples)]
  const cardinalityCap = Math.min(10, rowCount * 0.3)
  if (rowCount >= 5 && distinct.length <= cardinalityCap) {
    return { type: "singleSelect", choices: distinct }
  }
  return { type: "text" }
}

function stripNumeric(v: string): string {
  return v.replace(/[$¥€£,\s]|NT\$/gi, "")
}

/* 匯入單一格 → 記錄提交值(型別化,鏡射引擎 validateValues 期望;略過欄不呼叫)。
   回傳 undefined = 該格空值不送。 */
export function toImportValue(type: CellValueType, raw: string): unknown {
  const v = raw.trim()
  if (v === "") return undefined
  switch (type) {
    case "checkbox":
      return BOOL_TRUE.has(v.toLowerCase())
    case "number":
    case "percent":
    case "rating": {
      const n = Number(stripNumeric(v))
      return Number.isFinite(n) ? n : undefined
    }
    case "money": {
      const cleaned = stripNumeric(v)
      return cleaned === "" || Number.isNaN(Number(cleaned)) ? undefined : cleaned
    }
    case "dateTime": {
      const d = new Date(v)
      return Number.isNaN(d.getTime()) ? v : d.toISOString()
    }
    default:
      return v
  }
}

/* 空 / 重複欄名正規化(空 → 欄N;重複 → 附序號),保順序 */
export function normalizeColumnNames(raw: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((name, index) => {
    const base = name.trim() === "" ? `欄${index + 1}` : name.trim()
    const prior = seen.get(base) ?? 0
    seen.set(base, prior + 1)
    return prior === 0 ? base : `${base}_${prior + 1}`
  })
}
