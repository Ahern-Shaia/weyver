import { describe, expect, it } from "vitest"
import { sampleIsMono, sampleValue } from "./sample-value"
import { CELL_VALUE_TYPES } from "./schemas"

describe("設計模式示例值(OQ-FDW-1=A 依型別生成)", () => {
  /* 🔴 型別驅動的代價是**漏列一個型別 = 那個型別安靜地退回預設**
     —— display-value 就因此漏過 createdAt / updatedAt(單元測試全綠、瀏覽器才抓到)。
     故這裡對**全部型別**逐一斷言,不挑幾個測。 */
  it("🔴 每一個引擎型別都有示例值,且不得為空", () => {
    const missing: string[] = []
    for (const type of CELL_VALUE_TYPES) {
      const v = sampleValue({ type, options: {}, name: "測試欄" })
      if (v.trim() === "") missing.push(type)
    }
    expect(missing, `以下型別沒有示例值:${missing.join(", ")}`).toEqual([])
  })

  it("🔴 不得有型別落到 default 而顯示成通用文字", () => {
    /* default 回「範例文字」與 text 相同 —— 若某個**非文字**型別也回它,代表漏列。 */
    const generic = sampleValue({ type: "text", options: {}, name: "x" })
    const suspicious = CELL_VALUE_TYPES.filter(
      (t) => t !== "text" && sampleValue({ type: t, options: {}, name: "x" }) === generic,
    )
    expect(
      suspicious,
      `以下非文字型別回傳了與 text 相同的值,可能是漏列:${suspicious.join(", ")}`,
    ).toEqual([])
  })

  it("選項欄優先用該欄自己的選項", () => {
    const withChoices = {
      type: "singleSelect" as const,
      name: "檢驗結果",
      options: { choices: [{ label: "合格" }, { label: "不合格" }] },
    }
    expect(sampleValue(withChoices)).toBe("合格")
    /* 沒設選項才退回通用字樣 */
    expect(sampleValue({ type: "singleSelect", options: {}, name: "x" })).toBe("選項一")
  })

  it("計算類誠實標示為算出來的,不編假數字", () => {
    for (const t of ["formula", "rollup", "lookup"] as const) {
      expect(sampleValue({ type: t, options: {}, name: "x" })).toBe("（計算值）")
    }
  })

  it("日期類回今天,不寫死日期(寫死會在文件裡看起來像過期資料)", () => {
    const y = String(new Date().getFullYear())
    expect(sampleValue({ type: "date", options: {}, name: "x" })).toContain(y)
  })

  it("需對齊的型別標為等寬", () => {
    expect(sampleIsMono("money")).toBe(true)
    expect(sampleIsMono("date")).toBe(true)
    expect(sampleIsMono("text")).toBe(false)
  })
})
