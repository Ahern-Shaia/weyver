import Decimal from "decimal.js"
import type { FormulaType, FormulaValue } from "./value"
import { FormulaEvalError, toBool, toDecimal, toText, tryDecimal } from "./value"

/* 函數庫 registry(MVP ~30:math / logic / text / date / 聚合)。名稱大小寫不敏感。
   聚合(SUM/COUNT…)於單筆公式為 variadic scalar;Rollup 之跨列聚合為 P0-3 M4。 */

type Fn = (args: readonly FormulaValue[]) => FormulaValue

interface FnSpec {
  readonly impl: Fn
  readonly returns: FormulaType
}

function reqArg(args: readonly FormulaValue[], i: number): FormulaValue {
  const v = args[i]
  if (v === undefined) throw new FormulaEvalError(`缺少第 ${i + 1} 個引數`)
  return v
}

function optArg(args: readonly FormulaValue[], i: number, dflt: FormulaValue): FormulaValue {
  const v = args[i]
  return v === undefined ? dflt : v
}

function numericArgs(args: readonly FormulaValue[]): Decimal[] {
  const out: Decimal[] = []
  for (const a of args) {
    const d = tryDecimal(a)
    if (d !== null) out.push(d)
  }
  return out
}

function jsInt(v: FormulaValue): number {
  return Math.trunc(toDecimal(v).toNumber())
}

function parseDate(v: FormulaValue): Date {
  const d = new Date(toText(v))
  if (Number.isNaN(d.getTime())) throw new FormulaEvalError(`無法解析日期:${toText(v)}`)
  return d
}

const SPECS: Record<string, FnSpec> = {
  // ── math ──
  SUM: {
    returns: "number",
    impl: (a) => numericArgs(a).reduce((s, d) => s.plus(d), new Decimal(0)),
  },
  AVERAGE: {
    returns: "number",
    impl: (a) => {
      const n = numericArgs(a)
      if (n.length === 0) throw new FormulaEvalError("AVERAGE 需至少一個數值")
      return n.reduce((s, d) => s.plus(d), new Decimal(0)).div(n.length)
    },
  },
  MIN: {
    returns: "number",
    impl: (a) => {
      const n = numericArgs(a)
      if (n.length === 0) throw new FormulaEvalError("MIN 需至少一個數值")
      return Decimal.min(...n)
    },
  },
  MAX: {
    returns: "number",
    impl: (a) => {
      const n = numericArgs(a)
      if (n.length === 0) throw new FormulaEvalError("MAX 需至少一個數值")
      return Decimal.max(...n)
    },
  },
  COUNT: { returns: "number", impl: (a) => new Decimal(numericArgs(a).length) },
  ABS: { returns: "number", impl: (a) => toDecimal(reqArg(a, 0)).abs() },
  ROUND: {
    returns: "number",
    impl: (a) =>
      toDecimal(reqArg(a, 0)).toDecimalPlaces(
        jsInt(optArg(a, 1, new Decimal(0))),
        Decimal.ROUND_HALF_UP,
      ),
  },
  CEILING: { returns: "number", impl: (a) => toDecimal(reqArg(a, 0)).ceil() },
  FLOOR: { returns: "number", impl: (a) => toDecimal(reqArg(a, 0)).floor() },
  MOD: { returns: "number", impl: (a) => toDecimal(reqArg(a, 0)).mod(toDecimal(reqArg(a, 1))) },
  POWER: { returns: "number", impl: (a) => toDecimal(reqArg(a, 0)).pow(toDecimal(reqArg(a, 1))) },

  // ── logic ──
  IF: {
    returns: "unknown",
    impl: (a) => (toBool(reqArg(a, 0)) ? reqArg(a, 1) : optArg(a, 2, null)),
  },
  AND: { returns: "boolean", impl: (a) => a.every((v) => toBool(v)) },
  OR: { returns: "boolean", impl: (a) => a.some((v) => toBool(v)) },
  NOT: { returns: "boolean", impl: (a) => !toBool(reqArg(a, 0)) },
  ISBLANK: {
    returns: "boolean",
    impl: (a) => reqArg(a, 0) === null || toText(reqArg(a, 0)) === "",
  },

  // ── text ──
  CONCAT: { returns: "text", impl: (a) => a.map((v) => toText(v)).join("") },
  LEN: { returns: "number", impl: (a) => new Decimal(toText(reqArg(a, 0)).length) },
  TRIM: { returns: "text", impl: (a) => toText(reqArg(a, 0)).trim() },
  UPPER: { returns: "text", impl: (a) => toText(reqArg(a, 0)).toUpperCase() },
  LOWER: { returns: "text", impl: (a) => toText(reqArg(a, 0)).toLowerCase() },
  LEFT: {
    returns: "text",
    impl: (a) => toText(reqArg(a, 0)).slice(0, Math.max(0, jsInt(reqArg(a, 1)))),
  },
  RIGHT: {
    returns: "text",
    impl: (a) => {
      const s = toText(reqArg(a, 0))
      const n = Math.max(0, jsInt(reqArg(a, 1)))
      return n === 0 ? "" : s.slice(-n)
    },
  },
  MID: {
    returns: "text",
    impl: (a) => {
      const start = Math.max(1, jsInt(reqArg(a, 1)))
      const len = Math.max(0, jsInt(reqArg(a, 2)))
      return toText(reqArg(a, 0)).slice(start - 1, start - 1 + len)
    },
  },

  // ── date ──
  YEAR: { returns: "number", impl: (a) => new Decimal(parseDate(reqArg(a, 0)).getUTCFullYear()) },
  MONTH: { returns: "number", impl: (a) => new Decimal(parseDate(reqArg(a, 0)).getUTCMonth() + 1) },
  DAY: { returns: "number", impl: (a) => new Decimal(parseDate(reqArg(a, 0)).getUTCDate()) },
  DATEDIF: {
    returns: "number",
    impl: (a) => {
      const from = parseDate(reqArg(a, 0)).getTime()
      const to = parseDate(reqArg(a, 1)).getTime()
      return new Decimal(Math.trunc((to - from) / 86_400_000))
    },
  },
}

export function callFunction(name: string, args: readonly FormulaValue[]): FormulaValue {
  const spec = SPECS[name.toUpperCase()]
  if (spec === undefined) throw new FormulaEvalError(`未知函數:${name}`)
  return spec.impl(args)
}

export function functionReturnType(name: string): FormulaType | undefined {
  return SPECS[name.toUpperCase()]?.returns
}

export function isKnownFunction(name: string): boolean {
  return SPECS[name.toUpperCase()] !== undefined
}
