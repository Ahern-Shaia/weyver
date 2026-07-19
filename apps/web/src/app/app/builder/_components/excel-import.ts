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

export function inferColumnType(rawValues: readonly string[], rowCount: number): InferredColumn {
  const samples = nonEmpty(rawValues).slice(0, SAMPLE_LIMIT)
  if (samples.length === 0) return { type: "text" }

  if (allMatch(samples, isBooleanish)) return { type: "checkbox" }
  if (allMatch(samples, (v) => DATETIME_RE.test(v))) return { type: "dateTime" }
  if (allMatch(samples, (v) => DATE_RE.test(v))) return { type: "date" }
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
