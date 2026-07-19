import { describe, expect, it } from "vitest"
import { evaluateFormula } from "./evaluate"
import { FormulaEvalError, type FormulaValue, toText, tryDecimal } from "./value"

const record: Record<string, FormulaValue> = {
  單價: "12.5",
  數量: "4",
  稅率: "0.05",
  狀態: "已核准",
  有機: true,
  交期: "2026-07-22",
}
const resolve = (name: string): FormulaValue => record[name] ?? null

const num = (expr: string): string => toText(evaluateFormula(expr, resolve))

describe("evaluateFormula — 算術(Decimal 精度)", () => {
  it("單價 × 數量", () => {
    expect(num("{單價} * {數量}")).toBe("50")
  })
  it("含稅小計 + ROUND", () => {
    expect(num("ROUND({單價} * {數量} * (1 + {稅率}), 2)")).toBe("52.5")
  })
  it("Decimal 精度(0.1 + 0.2 = 0.3,非 0.30000000000000004)", () => {
    expect(num("0.1 + 0.2")).toBe("0.3")
  })
  it("除以零 → FormulaEvalError", () => {
    expect(() => evaluateFormula("{單價} / 0", resolve)).toThrow(FormulaEvalError)
  })
})

describe("evaluateFormula — 邏輯 / 比較 / 文字", () => {
  it("比較 + AND", () => {
    expect(evaluateFormula('{狀態} = "已核准" && {數量} >= 1', resolve)).toBe(true)
    expect(evaluateFormula('{狀態} = "退回"', resolve)).toBe(false)
  })
  it("IF 分支", () => {
    expect(evaluateFormula('IF({數量} > 10, "大量", "少量")', resolve)).toBe("少量")
  })
  it("字串串接 &", () => {
    expect(evaluateFormula('{狀態} & "-" & {數量}', resolve)).toBe("已核准-4")
  })
  it("CONCAT / UPPER / LEN", () => {
    expect(evaluateFormula('CONCAT("PO-", {數量})', resolve)).toBe("PO-4")
    expect(tryDecimal(evaluateFormula("LEN({狀態})", resolve))?.toString()).toBe("3")
  })
  it("SUM / MAX 聚合(variadic scalar)", () => {
    expect(num("SUM({單價}, {數量}, 10)")).toBe("26.5")
    expect(num("MAX({單價}, {數量})")).toBe("12.5")
  })
  it("布林欄位 + NOT", () => {
    expect(evaluateFormula("NOT({有機})", resolve)).toBe(false)
  })
})

describe("evaluateFormula — 日期", () => {
  it("YEAR / MONTH / DAY", () => {
    expect(num("YEAR({交期})")).toBe("2026")
    expect(num("MONTH({交期})")).toBe("7")
    expect(num("DAY({交期})")).toBe("22")
  })
  it("DATEDIF 天數", () => {
    expect(num('DATEDIF("2026-07-22", "2026-07-25")')).toBe("3")
  })
})
