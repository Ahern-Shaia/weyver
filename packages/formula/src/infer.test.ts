import { describe, expect, it } from "vitest"
import { inferFormulaType } from "./infer"
import type { FormulaType } from "./value"

const fieldTypes: Record<string, FormulaType> = {
  單價: "number",
  數量: "number",
  狀態: "text",
  交期: "date",
  有機: "boolean",
}
const resolve = (name: string): FormulaType => fieldTypes[name] ?? "unknown"

describe("inferFormulaType", () => {
  it("算術 → number", () => {
    expect(inferFormulaType("{單價} * {數量}", resolve)).toBe("number")
    expect(inferFormulaType("-{單價}", resolve)).toBe("number")
  })
  it("比較 / 邏輯 → boolean", () => {
    expect(inferFormulaType("{數量} > 10", resolve)).toBe("boolean")
    expect(inferFormulaType('{狀態} = "x" && {數量} > 0', resolve)).toBe("boolean")
  })
  it("串接 & → text", () => {
    expect(inferFormulaType("{狀態} & {數量}", resolve)).toBe("text")
  })
  it("字面量", () => {
    expect(inferFormulaType('"hi"', resolve)).toBe("text")
    expect(inferFormulaType("42", resolve)).toBe("number")
    expect(inferFormulaType("TRUE", resolve)).toBe("boolean")
  })
  it("函數回傳型別", () => {
    expect(inferFormulaType("ROUND({單價}, 2)", resolve)).toBe("number")
    expect(inferFormulaType("UPPER({狀態})", resolve)).toBe("text")
    expect(inferFormulaType("YEAR({交期})", resolve)).toBe("number")
  })
  it("IF → 分支型別", () => {
    expect(inferFormulaType('IF({數量} > 0, "有", "無")', resolve)).toBe("text")
    expect(inferFormulaType("IF({有機}, {單價}, 0)", resolve)).toBe("number")
  })
  it("欄位型別", () => {
    expect(inferFormulaType("{交期}", resolve)).toBe("date")
  })
})
