import { FormulaCycleError, toText } from "@weyver/formula"
import { describe, expect, it } from "vitest"
import { computeFormulaPreview, previewFormulaText } from "./formula-preview"

describe("computeFormulaPreview — 前端即時預覽(與後端同引擎)", () => {
  it("單價 × 數量 即時算", () => {
    const out = computeFormulaPreview([{ name: "小計", expr: "{單價} * {數量}" }], {
      單價: "12.5",
      數量: "4",
    })
    expect(toText(out.小計 ?? null)).toBe("50")
  })

  it("Decimal 精度(0.1 + 0.2 = 0.3)—— 與後端一致,非 float", () => {
    const out = computeFormulaPreview([{ name: "x", expr: "0.1 + 0.2" }], {})
    expect(toText(out.x ?? null)).toBe("0.3")
  })

  it("鏈式公式依拓樸序(小計 → 含稅)", () => {
    const out = computeFormulaPreview(
      [
        { name: "小計", expr: "{單價} * {數量}" },
        { name: "含稅", expr: "ROUND({小計} * 1.05, 2)" },
      ],
      { 單價: "100", 數量: "2" },
    )
    expect(toText(out.小計 ?? null)).toBe("200")
    expect(toText(out.含稅 ?? null)).toBe("210")
  })

  it("函數 + 條件 + 字串", () => {
    expect(
      previewFormulaText(
        [{ name: "標", expr: 'IF({數量} > 10, "大", "小")' }],
        { 數量: "3" },
        "標",
      ),
    ).toBe("小")
    expect(
      previewFormulaText([{ name: "全", expr: "{姓} & {名}" }], { 姓: "王", 名: "小明" }, "全"),
    ).toBe("王小明")
  })

  it("循環公式 → FormulaCycleError", () => {
    expect(() =>
      computeFormulaPreview(
        [
          { name: "a", expr: "{b} + 1" },
          { name: "b", expr: "{a} + 1" },
        ],
        {},
      ),
    ).toThrow(FormulaCycleError)
  })
})
