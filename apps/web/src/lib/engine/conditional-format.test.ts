import type { ChipTone } from "@weyver/ui/status-chip"
import { describe, expect, it } from "vitest"
import {
  evaluateFieldStates,
  evaluateFormats,
  evaluateMessages,
  renderMessage,
  sectionMembers,
  matchesCondition,
  resolveFieldAttrs,
} from "./conditional-format"
import type { FormatRule } from "./schemas"

/* R1·UP-3b 求值器單元測。重點:運算子語意、AND/OR、**後者覆蓋**、欄位缺失容錯。 */

const FIELDS = ["單號", "交期", "狀態", "金額"]

/* 測試 helper 仍以 `tone` 表達(可讀性高於逐條寫 `effects`),
   內部組成 C-1 的判別式形狀 —— 與相容讀取器同一個轉換。 */
const rule = (
  r: Partial<FormatRule> & Pick<FormatRule, "conditions"> & { tone: ChipTone },
): FormatRule => ({
  combinator: "and",
  targets: [],
  targetSections: [],
  enabled: true,
  ...r,
  effects: [{ kind: "color", tone: r.tone }],
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
        effects: [{ kind: "color", tone: "rainbow" }],
      },
    ] as unknown as FormatRule[]
    expect(evaluateFormats(rules, values, FIELDS).size).toBe(0)
  })

  /* 🔴 OQ-CF-8 = C-1 之後新增:**沒有 `effects` 的舊形狀不得讓求值器爆掉**。
     型別上 `effects` 必存,但型別不是執行期保證 —— 舊備份、手改的 JSONB、
     未經 zod 的路徑都可能送進來。渲染前最後一道要能吞掉它,而不是整頁白畫面。 */
  it("FMEA G1-bis:舊形狀(無 effects)略過而非拋錯", () => {
    const rules = [
      {
        combinator: "and",
        conditions: [{ field: "狀態", op: "eq", value: "待審" }],
        targets: ["狀態"],
        tone: "warn",
      },
    ] as unknown as FormatRule[]
    expect(() => evaluateFormats(rules, values, FIELDS)).not.toThrow()
    expect(evaluateFormats(rules, values, FIELDS).size).toBe(0)
  })

  it("同一條規則帶多個 color 效果時,取最後一個(與跨規則後者覆蓋同語意)", () => {
    const rules = [
      {
        combinator: "and",
        conditions: [{ field: "狀態", op: "eq", value: "待審" }],
        targets: ["狀態"],
        effects: [
          { kind: "color", tone: "ok" },
          { kind: "color", tone: "error" },
        ],
      },
    ] as unknown as FormatRule[]
    expect(evaluateFormats(rules, values, FIELDS).get("狀態")).toBe("error")
  })

  it("enabled: false 的規則不套用 —— 停用不是刪除,規則要留著", () => {
    const r = rule({ conditions: [{ field: "狀態", op: "eq", value: "待審" }], tone: "warn" })
    expect(evaluateFormats([{ ...r, enabled: false }], values, FIELDS).size).toBe(0)
    expect(evaluateFormats([r], values, FIELDS).size).toBe(1)
  })

  it("無規則 → 空結果(零成本短路)", () => {
    expect(evaluateFormats([], values, FIELDS).size).toBe(0)
  })
})

/* 🔴 OQ-CF-8 = C-2:純呈現效果(hide / readonly)+ S1 雙向邏輯 + S4 仲裁。

   S1 與 S4 是 Ragic 官方**用一整節〈問題排除〉在解釋**的東西 ——
   也就是說它們在真實使用中會被踩到,不是理論邊角。 */
describe("C-2 hide / readonly 效果", () => {
  const vals = { 單號: "PO-001", 交期: "2026-07-20", 狀態: "待審", 金額: "128400" }
  const hideRule = {
    combinator: "and",
    conditions: [{ field: "狀態", op: "eq", value: "待審" }],
    targets: ["金額"],
    effects: [{ kind: "hide" }],
    enabled: true,
  } as unknown as FormatRule

  it("命中時隱藏目標欄", () => {
    const st = evaluateFieldStates([hideRule], vals, FIELDS)
    expect(st.get("金額")?.hidden).toBe(true)
  })

  /* 🔴 S1 雙向邏輯(官方逐字):「當條件成立時執行某動作,也同時代表條件不成立時
     **不執行**該動作」。對顏色這條恰好等價(未命中即無色),對隱藏**不等價** ——
     若求值器改成增量更新,未命中就不會把欄位還原成顯示。 */
  it("S1:未命中 → 不套用(欄位回到預設,不是維持上一次的結果)", () => {
    const st = evaluateFieldStates([hideRule], { ...vals, 狀態: "已結案" }, FIELDS)
    expect(st.get("金額")).toBeUndefined()
  })

  it("一條規則可同時帶多種效果", () => {
    const r = {
      ...hideRule,
      effects: [{ kind: "readonly" }, { kind: "color", tone: "warn" }],
    } as unknown as FormatRule
    const st = evaluateFieldStates([r], vals, FIELDS)
    expect(st.get("金額")).toEqual({ readonly: true, tone: "warn" })
  })
})

describe("C-2 S4:靜態欄位屬性 × 條件式規則的仲裁", () => {
  /* 官方逐字 (3):「欄位設為**唯讀**的情況,**條件式格式必會優先於**欄位屬性設定」 */
  it("S4-3:唯讀由規則說了算(規則有講就聽規則)", () => {
    expect(resolveFieldAttrs({ readonly: true }, { readonly: true }).readonly).toBe(true)
    expect(resolveFieldAttrs({ readonly: false }, { readonly: true }).readonly).toBe(true)
  })

  it("規則沒講到唯讀時,回到靜態值 —— 不是一律覆蓋成 false", () => {
    expect(resolveFieldAttrs({ readonly: true }, { tone: "warn" }).readonly).toBe(true)
    expect(resolveFieldAttrs({ readonly: true }, undefined).readonly).toBe(true)
  })

  /* 官方逐字 (1):已設為隱藏的欄位,條件式格式**無法選擇**再把它顯示 */
  it("S4-1:靜態隱藏為終局,規則不得把它顯示回來", () => {
    expect(resolveFieldAttrs({ hidden: true }, undefined).hidden).toBe(true)
    expect(resolveFieldAttrs({ hidden: true }, { readonly: true }).hidden).toBe(true)
  })

  /* 官方逐字:「當欄位因條件式格式被**隱藏**時,系統會**略過檢查必填及輸入檢查**」 */
  it("因規則被隱藏 → 略過必填檢查(否則使用者卡死在看不見的欄位上)", () => {
    expect(resolveFieldAttrs({}, { hidden: true }).skipValidation).toBe(true)
  })

  it("🔴 但**靜態**隱藏不觸發略過 —— 兩者成因不同,不可混為一談", () => {
    /* 靜態隱藏是設計者一開始就決定這張表不填這欄,必填與否由他自己設定;
       條件式隱藏是「此情境下不適用」,才需要連帶放掉必填。 */
    expect(resolveFieldAttrs({ hidden: true }, undefined).skipValidation).toBe(false)
  })
})

/* ── C-2 後半|分段展開(OQ-CF-9)────────────────────────────────── */

describe("sectionMembers", () => {
  const rows = new Map([
    ["單號", 0],
    ["交期", 1],
    ["狀態", 2],
    ["金額", 5],
  ])

  it("以列區間推導成員 —— 上下界含端點", () => {
    const m = sectionMembers([{ id: "s1", fromRow: 1, toRow: 2 }], rows)
    expect(m.get("s1")).toEqual(["交期", "狀態"])
  })

  it("🔴 fromRow > toRow 也要吃得下 —— 設計器允許拖成反向,不該靜默變成空分段", () => {
    const m = sectionMembers([{ id: "s1", fromRow: 2, toRow: 1 }], rows)
    expect(m.get("s1")).toEqual(["交期", "狀態"])
  })
})

describe("分段作為目標選擇器", () => {
  const members = new Map([["s1", ["交期", "狀態"]]])
  const base = rule({ conditions: [{ field: "單號", op: "isNotEmpty" }], tone: "warn" })

  it("targetSections 展開成該段欄位,效果照套", () => {
    const r: FormatRule = { ...base, targetSections: ["s1"], effects: [{ kind: "hide" }] }
    const st = evaluateFieldStates([r], { 單號: "A" }, FIELDS, members)
    expect(st.get("交期")?.hidden).toBe(true)
    expect(st.get("狀態")?.hidden).toBe(true)
    expect(st.get("金額")).toBeUndefined()
  })

  it("與 targets 併集,不是二選一", () => {
    const r: FormatRule = {
      ...base,
      targets: ["金額"],
      targetSections: ["s1"],
      effects: [{ kind: "readonly" }],
    }
    const st = evaluateFieldStates([r], { 單號: "A" }, FIELDS, members)
    expect(st.get("金額")?.readonly).toBe(true)
    expect(st.get("交期")?.readonly).toBe(true)
  })

  /* 🔴 這一條是 OQ-CF-9 的理由本身:分段級與欄位級規則在**同一個仲裁空間**裡,
     所以官方的「由上而下、後者覆蓋」跨兩者自動一致。若分段另立一軸就表達不出來。 */
  it("🔴 後面的欄位級規則覆蓋前面的分段級規則", () => {
    const secRule: FormatRule = { ...base, targetSections: ["s1"], effects: [{ kind: "hide" }] }
    const fieldRule: FormatRule = {
      ...base,
      targets: ["交期"],
      effects: [{ kind: "color", tone: "ok" }],
    }
    const st = evaluateFieldStates([secRule, fieldRule], { 單號: "A" }, FIELDS, members)
    expect(st.get("交期")?.tone).toBe("ok")
    expect(st.get("交期")?.hidden).toBe(true) // hide 仍在(不同效果,各自覆蓋)
  })

  it("分段不存在 → 略過該分段,其餘照套(同目標欄已刪的處置)", () => {
    const r: FormatRule = {
      ...base,
      targets: ["金額"],
      targetSections: ["不存在"],
      effects: [{ kind: "hide" }],
    }
    const st = evaluateFieldStates([r], { 單號: "A" }, FIELDS, members)
    expect(st.get("金額")?.hidden).toBe(true)
    expect(st.size).toBe(1)
  })
})

/* ── C-2 後半|顯示訊息(OQ-CF-11)──────────────────────────────── */

describe("renderMessage", () => {
  const known = new Set(FIELDS)

  it("帶入欄位值與欄位標題", () => {
    const out = renderMessage(
      "{{fieldName:交期}} 是 {{fieldValue:交期}}",
      { 交期: "2026-03-05" },
      known,
    )
    expect(out).toBe("交期 是 2026-03-05")
  })

  /* 🔴 本模組最重要的一條:插值**不得成為遮罩的旁路**。
     值不在 values 裡 = 這個人沒有權限看 → 具名,不留空。
     留空會讓他以為那一欄沒資料,而真相是他看不到。 */
  it("🔴 欄位對此人遮罩(不在 values 裡)→ 具名而非留空", () => {
    expect(renderMessage("薪資:{{fieldValue:金額}}", { 單號: "A" }, known)).toBe("薪資:(無權檢視)")
  })

  it("值為 null → 空字串(那是真的沒填,與沒權限不同)", () => {
    expect(renderMessage("[{{fieldValue:金額}}]", { 金額: null }, known)).toBe("[]")
  })

  it("欄位不存在 → 參數原樣留著,讓設計者看得出是名字打錯", () => {
    expect(renderMessage("{{fieldValue:不存在}}", {}, known)).toBe("{{fieldValue:不存在}}")
  })

  it("未知前綴不處理 —— 不把任意 {{}} 都當參數", () => {
    expect(renderMessage("{{whatever:交期}}", { 交期: "x" }, known)).toBe("{{whatever:交期}}")
    expect(renderMessage("{{交期}}", { 交期: "x" }, known)).toBe("{{交期}}")
  })

  /* 🔴 欄名可以含冒號,Ragic 用欄位編號才沒有這個歧義 —— 故只切第一個 */
  it("🔴 欄名含冒號:只切第一個分隔符", () => {
    const k = new Set(["備註:內部"])
    expect(renderMessage("{{fieldValue:備註:內部}}", { "備註:內部": "OK" }, k)).toBe("OK")
  })

  /* 🔴 訊息文字與帶入的值都是不可信輸入。這裡只保證**不做任何解碼或標記解析**;
     渲染端一律純文字(禁 dangerouslySetInnerHTML),由 e2e 釘住。 */
  it("🔴 值裡的標記原樣帶出,不解析", () => {
    const out = renderMessage(
      "{{fieldValue:單號}}",
      { 單號: "<img src=x onerror=alert(1)>" },
      known,
    )
    expect(out).toBe("<img src=x onerror=alert(1)>")
  })
})

describe("evaluateMessages", () => {
  const msg = (text: string, field = "狀態", value: unknown = "逾期"): FormatRule => ({
    combinator: "and",
    conditions: [{ field, op: "eq", value }],
    targets: [],
    targetSections: [],
    effects: [{ kind: "message", text }],
    enabled: true,
  })

  it("命中才出現,依規則順序", () => {
    const rules = [msg("第一則"), msg("第二則")]
    expect(evaluateMessages(rules, { 狀態: "逾期" }, FIELDS)).toEqual(["第一則", "第二則"])
    expect(evaluateMessages(rules, { 狀態: "正常" }, FIELDS)).toEqual([])
  })

  it("停用的規則不出訊息", () => {
    expect(evaluateMessages([{ ...msg("X"), enabled: false }], { 狀態: "逾期" }, FIELDS)).toEqual(
      [],
    )
  })

  it("插值後為空 → 不推一則空白訊息", () => {
    expect(
      evaluateMessages([msg("{{fieldValue:金額}}")], { 狀態: "逾期", 金額: null }, FIELDS),
    ).toEqual([])
  })
})
