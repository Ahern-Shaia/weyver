import type { CellValueType, FieldDto } from "@/lib/engine/schemas"
import { describe, expect, it } from "vitest"
import { formatFieldValue, toSubmitValue } from "./field-value"

function field(type: CellValueType, options: Record<string, unknown> = {}): FieldDto {
  return { id: 1, name: "f", type, required: false, unique: false, options, position: 0 }
}

describe("toSubmitValue", () => {
  it("keeps money as trimmed decimal string (禁 float)", () => {
    expect(toSubmitValue(field("money"), " 128400.0000 ")).toBe("128400.0000")
    expect(toSubmitValue(field("money"), "")).toBeUndefined()
  })

  it("converts numeric strings to numbers", () => {
    expect(toSubmitValue(field("number"), "42.5")).toBe(42.5)
    expect(toSubmitValue(field("rating"), "3")).toBe(3)
    expect(toSubmitValue(field("percent"), "")).toBeUndefined()
    expect(toSubmitValue(field("number"), "abc")).toBe("abc")
  })

  /* 🔴 迴歸(#96 瀏覽器實走):member 值是 number,一旦落到 default 的字串分支
     就會被當成「沒填」丟掉 —— 畫面選了人、存進去卻是空的,且完全沒有錯誤。 */
  it("member 送出 actor id(number),不被字串分支吃掉", () => {
    expect(toSubmitValue(field("member"), 58)).toBe(58)
    expect(toSubmitValue(field("member"), null)).toBeNull() // 明確取消指派
    expect(toSubmitValue(field("member"), undefined)).toBeUndefined() // 沒碰過 → 不送
    expect(toSubmitValue(field("member"), 0)).toBeUndefined()
  })

  it("converts checkbox to boolean, multiSelect to non-empty array", () => {
    expect(toSubmitValue(field("checkbox"), true)).toBe(true)
    expect(toSubmitValue(field("checkbox"), undefined)).toBe(false)
    expect(toSubmitValue(field("multiSelect"), ["a", "b"])).toEqual(["a", "b"])
    expect(toSubmitValue(field("multiSelect"), [])).toBeUndefined()
  })

  it("converts datetime-local to ISO with offset", () => {
    const iso = toSubmitValue(field("dateTime"), "2026-07-19T10:00")
    expect(iso as string).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
  })

  it("skips autoNumber / stub types entirely", () => {
    expect(toSubmitValue(field("autoNumber"), "PO-1")).toBeUndefined()
    expect(toSubmitValue(field("formula"), "x")).toBeUndefined()
    expect(toSubmitValue(field("link"), 5)).toBeUndefined()
  })

  it("trims text and omits empties", () => {
    expect(toSubmitValue(field("text"), "  hi  ")).toBe("hi")
    expect(toSubmitValue(field("text"), "   ")).toBeUndefined()
  })
})

describe("formatFieldValue", () => {
  it("renders null / bool / multiSelect / datetime readably", () => {
    expect(formatFieldValue(field("text"), null)).toBe("—")
    expect(formatFieldValue(field("checkbox"), true)).toBe("是")
    expect(formatFieldValue(field("multiSelect"), ["急件", "冷鏈"])).toBe("急件、冷鏈")
    expect(formatFieldValue(field("dateTime"), "2026-07-19T10:00:00.000Z")).toBe(
      "2026-07-19 10:00:00",
    )
  })
})
