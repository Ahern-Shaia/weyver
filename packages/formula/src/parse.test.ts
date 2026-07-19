import { describe, expect, it } from "vitest"
import { FormulaSyntaxError, parseFormula } from "./parse"

describe("parseFormula", () => {
  it("解析算術 + 欄位參照(unicode)→ AST", () => {
    const ast = parseFormula("{單價} * {數量} + 100")
    expect(ast).toBeDefined()
    expect(ast.text.length).toBeGreaterThan(0)
  })

  it("解析函數呼叫 + 巢狀", () => {
    expect(() => parseFormula("SUM({金額}) / 2")).not.toThrow()
    expect(() => parseFormula('IF({數量} > 0, "有貨", "缺貨")')).not.toThrow()
    expect(() => parseFormula("ROUND({單價} * {數量} * (1 + {稅率}), 0)")).not.toThrow()
  })

  it("字串 / 布林 / 比較運算(等於為單 =,Excel 式)", () => {
    expect(() => parseFormula('{狀態} = "已核准" && {金額} >= 1000')).not.toThrow()
  })

  it("語法錯誤 → FormulaSyntaxError(帶位置)", () => {
    expect(() => parseFormula("{單價} * * 2")).toThrow(FormulaSyntaxError)
    try {
      parseFormula("{單價} +")
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaSyntaxError)
      expect(typeof (e as FormulaSyntaxError).column).toBe("number")
    }
  })
})
