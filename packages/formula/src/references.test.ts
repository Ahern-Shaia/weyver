import { describe, expect, it } from "vitest"
import { collectFormulaReferences } from "./references"

describe("collectFormulaReferences", () => {
  it("抽出多個欄位參照(保序去重)", () => {
    expect(collectFormulaReferences("{單價} * {數量} + {運費}")).toEqual(["單價", "數量", "運費"])
  })
  it("巢狀函數內的參照", () => {
    expect(collectFormulaReferences("ROUND({單價} * {數量} * (1 + {稅率}), 2)")).toEqual([
      "單價",
      "數量",
      "稅率",
    ])
  })
  it("重複參照去重", () => {
    expect(collectFormulaReferences("{金額} + {金額} * 0.05")).toEqual(["金額"])
  })
  it("無參照(純字面)→ 空陣列", () => {
    expect(collectFormulaReferences("1 + 2 * 3")).toEqual([])
  })
  it("條件與比較內的參照", () => {
    expect(collectFormulaReferences('IF({狀態} = "已核准", {金額}, 0)')).toEqual(["狀態", "金額"])
  })
})
