import { Decimal, type FormulaValue, callFunction, tryDecimal } from "@weyver/formula"

/* R1·UP-4 rollup 聚合純函式(RollupService 與 RecordService 讀時注入共用,避免服務循環依賴)。 */

export type AggregateFn = "SUM" | "COUNT" | "AVERAGE" | "MIN" | "MAX"

export function toFormulaValue(raw: unknown): FormulaValue {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "boolean") return raw
  return String(raw)
}

export function aggregate(fn: AggregateFn, values: readonly FormulaValue[]): FormulaValue {
  if (fn === "COUNT") return new Decimal(values.length)
  if (fn === "SUM") return callFunction("SUM", values) // SUM([]) = 0
  const hasNumeric = values.some((v) => tryDecimal(v) !== null)
  if (!hasNumeric) return null // AVERAGE / MIN / MAX 於空集 → null(不拋)
  return callFunction(fn, values)
}
