import { describe, expect, it } from "vitest"
import { evaluateFormats, matchesCondition } from "./conditional-format"
import type { FormatRule } from "./schemas"

/* R1·UP-3b 求值器單元測。重點:運算子語意、AND/OR、**後者覆蓋**、欄位缺失容錯。 */

const FIELDS = ["單號", "交期", "狀態", "金額"]

const rule = (r: Partial<FormatRule> & Pick<FormatRule, "conditions" | "tone">): FormatRule => ({
  combinator: "and",
  targets: [],
  ...r,
})

describe("matchesCondition", () => {
  it("空值判定:空字串 / null / 空陣列皆為 empty", () => {
    for (const v of ["", null, undefined, []])
      expect(matchesCondition(v, "isEmpty", null)).toBe(true)
    expect(matchesCondition("x", "isEmpty", null)).toBe(false)
    expect(matchesCondition("x", "isNotEmpty", null)).toBe(true)
  })

  it("eq / neq 以文字比較(數值 5 與字串 '5' 視為相同)", () => {
    expect(matchesCondition(5, "eq", "5")).toBe(true)
    expect(matchesCondition("待審", "neq", "已核准")).toBe(true)
  })

  it("contains 為子字串", () => {
    expect(matchesCondition("急件補貨", "contains", "急")).toBe(true)
    expect(matchesCondition("一般", "contains", "急")).toBe(false)
  })

  it("有序比較:兩邊皆數值走數值,否則字典序(ISO 日期即時序)", () => {
    expect(matchesCondition("100", "gt", 20)).toBe(true) // 數值比較,非字典序
    expect(matchesCondition("2026-07-20", "lt", "2026-08-01")).toBe(true)
    expect(matchesCondition("2026-09-01", "lt", "2026-08-01")).toBe(false)
  })

  it("空值不參與有序比較(避免把空當 0 或空字串誤判)", () => {
    expect(matchesCondition(null, "lt", "2026-08-01")).toBe(false)
    expect(matchesCondition("", "gt", 0)).toBe(false)
  })

  it("anyOf 支援多選欄(陣列值命中其一即可)", () => {
    expect(matchesCondition(["A", "B"], "anyOf", ["B", "C"])).toBe(true)
    expect(matchesCondition(["A"], "anyOf", ["B"])).toBe(false)
  })

  it("未知運算子 → false(不誤判為命中)", () => {
    expect(matchesCondition("x", "matchesRegex", ".*")).toBe(false)
  })
})

describe("evaluateFormats", () => {
  const values = { 單號: "PO-001", 交期: "2026-07-20", 狀態: "待審", 金額: "128400" }

  it("AND:全部條件符合才命中", () => {
    const rules = [
      rule({
        conditions: [
          { field: "交期", op: "lt", value: "2026-08-01" },
          { field: "狀態", op: "neq", value: "已核准" },
        ],
        targets: ["交期", "狀態"],
        tone: "error",
      }),
    ]
    const out = evaluateFormats(rules, values, FIELDS)
    expect(out.get("交期")).toBe("error")
    expect(out.get("狀態")).toBe("error")
    expect(out.get("金額")).toBeUndefined()
  })

  it("AND:其一不符即整條不命中", () => {
    const rules = [
      rule({
        combinator: "and",
        conditions: [
          { field: "交期", op: "lt", value: "2026-08-01" },
          { field: "狀態", op: "eq", value: "已核准" },
        ],
        targets: ["交期"],
        tone: "error",
      }),
    ]
    expect(evaluateFormats(rules, values, FIELDS).size).toBe(0)
  })

  it("OR:任一符合即命中", () => {
    const rules = [
      rule({
        combinator: "or",
        conditions: [
          { field: "狀態", op: "eq", value: "已核准" },
          { field: "交期", op: "lt", value: "2026-08-01" },
        ],
        targets: ["交期"],
        tone: "warn",
      }),
    ]
    expect(evaluateFormats(rules, values, FIELDS).get("交期")).toBe("warn")
  })

  it("**後者覆蓋**(Ragic 語意):同欄命中多條 → 以最後一條為準", () => {
    const rules = [
      rule({
        conditions: [{ field: "狀態", op: "eq", value: "待審" }],
        targets: ["狀態"],
        tone: "warn",
      }),
      rule({
        conditions: [{ field: "交期", op: "lt", value: "2026-08-01" }],
        targets: ["狀態"],
        tone: "error",
      }),
    ]
    expect(evaluateFormats(rules, values, FIELDS).get("狀態")).toBe("error")

    // 反轉順序 → 結果跟著反轉(證明順序真的決定結果)
    expect(evaluateFormats([...rules].reverse(), values, FIELDS).get("狀態")).toBe("warn")
  })

  it("targets 為空 → 套用到條件所涉之欄位", () => {
    const rules = [rule({ conditions: [{ field: "金額", op: "gt", value: 100000 }], tone: "c1" })]
    expect(evaluateFormats(rules, values, FIELDS).get("金額")).toBe("c1")
  })

  it("FMEA G4:條件引用已刪欄位 → 略過該規則,其餘規則照常", () => {
    const rules = [
      rule({ conditions: [{ field: "已刪欄", op: "isEmpty" }], targets: ["狀態"], tone: "error" }),
      rule({
        conditions: [{ field: "狀態", op: "eq", value: "待審" }],
        targets: ["狀態"],
        tone: "warn",
      }),
    ]
    expect(evaluateFormats(rules, values, FIELDS).get("狀態")).toBe("warn")
  })

  it("FMEA G4:目標欄已刪 → 略過該欄,同規則其他目標照套", () => {
    const rules = [
      rule({
        conditions: [{ field: "狀態", op: "eq", value: "待審" }],
        targets: ["已刪欄", "狀態"],
        tone: "warn",
      }),
    ]
    const out = evaluateFormats(rules, values, FIELDS)
    expect(out.get("狀態")).toBe("warn")
    expect(out.has("已刪欄")).toBe(false)
  })

  it("FMEA G1:非白名單 tone → 略過(不進入渲染)", () => {
    const rules = [
      {
        combinator: "and",
        conditions: [{ field: "狀態", op: "eq", value: "待審" }],
        targets: ["狀態"],
        tone: "rainbow",
      },
    ] as unknown as FormatRule[]
    expect(evaluateFormats(rules, values, FIELDS).size).toBe(0)
  })

  it("無規則 → 空結果(零成本短路)", () => {
    expect(evaluateFormats([], values, FIELDS).size).toBe(0)
  })
})
