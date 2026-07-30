import type { CellValueType, FieldDto } from "@/lib/engine/schemas"
import { describe, expect, it } from "vitest"
import { choicesOf, formatFieldValue, toSubmitValue } from "@/components/form/value"

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

describe("formatFieldValue 之來源標記", () => {
  it("帶入來源已刪除 / 無權檢視 → 翻成人看得懂的字,不印引擎標記", () => {
    expect(formatFieldValue(field("lookup"), "__source_deleted__")).toBe("來源已刪除")
    expect(formatFieldValue(field("lookup"), "__source_restricted__")).toBe("無權檢視")
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

/* 🔴 迴歸(F-1 實走揪出):#105 把 options.choices 從字串陣列改成 {id,name} 物件,
   但這個讀取端沒跟上 → 填單的單選下拉、篩選、看板分欄全部拿到空清單。
   型別上是 unknown,所以它靜默通過了型別檢查與所有測試。 */
describe("choicesOf 相容 v1 字串與 v2 物件", () => {
  const withChoices = (choices: unknown): FieldDto => field("singleSelect", { choices })

  it("v2 物件選項回傳名稱(#105 之後的實際形狀)", () => {
    expect(
      choicesOf(withChoices([{ id: "o1", name: "新單" }, { id: "o2", name: "已完成" }])),
    ).toEqual(["新單", "已完成"])
  })

  it("v1 字串選項仍相容(舊資料 / 舊 API 呼叫端)", () => {
    expect(choicesOf(withChoices(["甲", "乙"]))).toEqual(["甲", "乙"])
  })

  it("停用(retired)的選項不出現在可選清單", () => {
    expect(
      choicesOf(withChoices([{ id: "o1", name: "在用" }, { id: "o2", name: "停用", retired: true }])),
    ).toEqual(["在用"])
  })

  it("非陣列 / 空 options 回空陣列(不炸)", () => {
    expect(choicesOf(withChoices(undefined))).toEqual([])
    expect(choicesOf(field("text"))).toEqual([])
  })
})
