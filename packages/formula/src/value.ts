import Decimal from "decimal.js"

/* 公式值模型 + 型別強制轉換。數值一律 Decimal(禁 float,對齊金額 numeric 鐵則)。 */

export type FormulaValue = Decimal | string | boolean | null

export type FormulaType = "number" | "text" | "boolean" | "date" | "unknown"

export class FormulaEvalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FormulaEvalError"
  }
}

export { Decimal }

export function tryDecimal(v: FormulaValue): Decimal | null {
  if (v instanceof Decimal) return v
  if (typeof v === "boolean") return new Decimal(v ? 1 : 0)
  if (v === null) return null
  try {
    const d = new Decimal(v)
    return d.isNaN() ? null : d
  } catch {
    return null
  }
}

export function toDecimal(v: FormulaValue): Decimal {
  if (v === null) return new Decimal(0)
  const d = tryDecimal(v)
  if (d === null) throw new FormulaEvalError(`無法轉為數值:${String(v)}`)
  return d
}

export function toText(v: FormulaValue): string {
  if (v === null) return ""
  if (v instanceof Decimal) return v.toString()
  if (typeof v === "boolean") return v ? "true" : "false"
  return v
}

export function toBool(v: FormulaValue): boolean {
  if (typeof v === "boolean") return v
  if (v === null) return false
  if (v instanceof Decimal) return !v.isZero()
  return v.length > 0
}

export function equalsValue(l: FormulaValue, r: FormulaValue): boolean {
  if (typeof l === "boolean" || typeof r === "boolean") return toBool(l) === toBool(r)
  const dl = tryDecimal(l)
  const dr = tryDecimal(r)
  if (dl !== null && dr !== null) return dl.equals(dr)
  return toText(l) === toText(r)
}

export function compareValue(l: FormulaValue, r: FormulaValue): number {
  const dl = tryDecimal(l)
  const dr = tryDecimal(r)
  if (dl !== null && dr !== null) return dl.comparedTo(dr)
  const sl = toText(l)
  const sr = toText(r)
  return sl < sr ? -1 : sl > sr ? 1 : 0
}
