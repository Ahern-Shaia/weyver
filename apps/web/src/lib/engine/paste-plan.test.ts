import { describe, expect, it } from "vitest"
import { buildPastePlan, describePasteEffects, planPasteCell } from "./paste-plan"
import type { CellValueType, FieldDto, RecordRow } from "./schemas"

function field(name: string, type: CellValueType, options: Record<string, unknown> = {}): FieldDto {
  return { id: 1, name, type, required: false, position: 0, options } as unknown as FieldDto
}

function record(id: number): RecordRow {
  return { id, version: 1, values: {} } as unknown as RecordRow
}

describe("planPasteCell", () => {
  it("計算欄跳過並可被計數 —— 不是靜默丟掉(OQ-GP-4)", () => {
    for (const t of ["formula", "autoNumber", "rollup", "lookup", "updatedAt"] as const) {
      expect(planPasteCell(field("x", t), "123")).toEqual({ kind: "skip", reason: "computed" })
    }
  })

  it("附件 / 關聯與計算欄分開報 —— 成因不同,講成同一句話使用者無從處理", () => {
    expect(planPasteCell(field("附件", "attachment"), "a.pdf")).toEqual({
      kind: "skip",
      reason: "unpasteable",
    })
  })

  it("空格是明確清空,不是「不動」—— 否則貼完舊值還在,而畫面那格是空的", () => {
    expect(planPasteCell(field("備註", "text"), "   ")).toEqual({ kind: "set", value: null })
    expect(planPasteCell(field("已結案", "checkbox"), "")).toEqual({ kind: "set", value: false })
  })

  it("文字貼進數值欄要標紅,不得靜默變空(Baserow 的反面教材)", () => {
    expect(planPasteCell(field("數量", "number"), "abc")).toEqual({
      kind: "invalid",
      message: "「abc」不是數值",
    })
  })

  it("數值吃掉 Excel 的千分位與百分號", () => {
    expect(planPasteCell(field("數量", "number"), "1,234.5")).toEqual({
      kind: "set",
      value: 1234.5,
    })
    expect(planPasteCell(field("毛利", "percent"), "12%")).toEqual({ kind: "set", value: 12 })
  })

  it("🔴 金額回傳字串不是 float —— AGENTS 鐵則 2", () => {
    const r = planPasteCell(field("小計", "money"), "NT$ 1,234.50")
    expect(r).toEqual({ kind: "set", value: "1234.50" })
    expect(typeof (r as { value: unknown }).value).toBe("string")
  })

  it("金額格式不對要擋,不能原樣送去撞後端 422", () => {
    expect(planPasteCell(field("小計", "money"), "一千二").kind).toBe("invalid")
  })

  it("🔴 date 取本地年月日,不走 toISOString —— 否則時區會把 8/3 變成 8/2", () => {
    expect(planPasteCell(field("交期", "date"), "2026/8/3")).toEqual({
      kind: "set",
      value: "2026-08-03",
    })
  })

  it("不是日期就標紅", () => {
    expect(planPasteCell(field("交期", "date"), "下週三").kind).toBe("invalid")
  })

  it("單選必須落在選項清單內,錯的值要指名是哪一欄", () => {
    const f = field("狀態", "singleSelect", { choices: ["待處理", "已完成"] })
    expect(planPasteCell(f, "已完成")).toEqual({ kind: "set", value: "已完成" })
    expect(planPasteCell(f, "處理中")).toEqual({
      kind: "invalid",
      message: "「處理中」不在「狀態」的選項中",
    })
  })

  it("多選吃半形與全形分隔,任一項不合法即整格不合法", () => {
    const f = field("標籤", "multiSelect", { choices: ["急件", "外包"] })
    expect(planPasteCell(f, "急件、外包")).toEqual({ kind: "set", value: ["急件", "外包"] })
    expect(planPasteCell(f, "急件,不存在").kind).toBe("invalid")
  })

  it("成員以姓名對到 actor id,對不到要說找不到誰", () => {
    const ids = new Map([["王小明", 7]])
    expect(planPasteCell(field("負責人", "member"), "王小明", ids)).toEqual({
      kind: "set",
      value: 7,
    })
    expect(planPasteCell(field("負責人", "member"), "查無此人", ids)).toEqual({
      kind: "invalid",
      message: "找不到成員「查無此人」",
    })
  })

  it("勾選欄吃常見的中英文寫法", () => {
    const f = field("已結案", "checkbox")
    expect(planPasteCell(f, "是")).toEqual({ kind: "set", value: true })
    expect(planPasteCell(f, "FALSE")).toEqual({ kind: "set", value: false })
    expect(planPasteCell(f, "也許").kind).toBe("invalid")
  })
})

describe("buildPastePlan", () => {
  const fields = [field("品名", "text"), field("數量", "number"), field("編號", "autoNumber")]

  it("落在既有列的成為 update,超出的成為待確認新增列(OQ-GP-3)", () => {
    const plan = buildPastePlan({
      rows: [
        ["筆", "10", "x"],
        ["紙", "20", "x"],
      ],
      targetCol: 0,
      targetRow: 0,
      fields,
      records: [record(101)],
    })
    expect(plan.updates).toEqual([{ recordId: 101, values: { 品名: "筆", 數量: 10 } }])
    expect(plan.newRows).toEqual([{ 品名: "紙", 數量: 20 }])
    expect(plan.skippedComputed).toBe(2)
  })

  it("貼上位置有偏移時,欄位對映跟著偏移", () => {
    const plan = buildPastePlan({
      rows: [["99"]],
      targetCol: 1,
      targetRow: 0,
      fields,
      records: [record(101)],
    })
    expect(plan.updates[0]?.values).toEqual({ 數量: 99 })
  })

  it("🔴 超出最右欄的格數要回報 —— 靜默丟掉正是四家共同的反面教材", () => {
    const plan = buildPastePlan({
      rows: [["筆", "10", "x", "多的", "更多"]],
      targetCol: 0,
      targetRow: 0,
      fields,
      records: [record(101)],
    })
    expect(plan.droppedCols).toBe(2)
    expect(describePasteEffects(plan).join(" ")).toContain("2 格超出最右欄")
  })

  it("不合法的格帶著網格座標回來 —— 錯誤要指得出是哪一格,不是「匯入失敗」四個字", () => {
    const plan = buildPastePlan({
      rows: [
        ["筆", "十"],
        ["紙", "20"],
      ],
      targetCol: 0,
      targetRow: 3,
      fields,
      records: [record(1), record(2), record(3), record(4), record(5)],
    })
    expect(plan.invalid).toEqual([{ row: 3, col: 1, message: "「十」不是數值" }])
  })

  it("完全乾淨的貼上不產生任何說明文字", () => {
    const plan = buildPastePlan({
      rows: [["筆"]],
      targetCol: 0,
      targetRow: 0,
      fields: [field("品名", "text")],
      records: [record(101)],
    })
    expect(describePasteEffects(plan)).toEqual([])
  })
})
