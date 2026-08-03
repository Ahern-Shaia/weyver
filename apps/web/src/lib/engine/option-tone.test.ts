import { describe, expect, it } from "vitest"
import { chipValues, isChipField, optionTone } from "./option-tone"
import type { FieldDto } from "./schemas"

/* 🔴 這組測試存在的理由:#105 把選項結構從
     v1 `{ choices: string[], colors: Record<名, 色> }`
   改成
     v2 `{ choices: [{ id, name, color? }] }`
   而 `optionTone` 漏改 —— 結果是**所有選項章一律渲染成灰色**,且不報任何錯
   (`options` 的型別是 `Record<string, unknown>`,查不到只會拿到 undefined)。

   那個 bug 只有 e2e 的 `getComputedStyle` 斷言抓得到,而那條 e2e 紅了好幾天沒人追。
   純資料映射不該只靠 e2e 守 —— 這一層跑得快、壞了指得準,才是它該待的地方。 */

const field = (options: Record<string, unknown>): FieldDto => ({
  id: 1,
  name: "狀態",
  type: "singleSelect",
  required: false,
  unique: false,
  options,
  position: 0,
})

const V2 = field({
  choices: [
    { id: "oaaaaaaa1", name: "草稿", color: "neutral" },
    { id: "oaaaaaaa2", name: "待審", color: "warn" },
    { id: "oaaaaaaa3", name: "已核准", color: "ok" },
    { id: "oaaaaaaa4", name: "無色" },
  ],
})

describe("optionTone(v2 選項身分模型)", () => {
  it("🔴 依 choice 物件內的 color 上色", () => {
    expect(optionTone(V2, "待審")).toBe("warn")
    expect(optionTone(V2, "已核准")).toBe("ok")
    expect(optionTone(V2, "草稿")).toBe("neutral")
  })

  it("未設色的選項 → neutral", () => {
    expect(optionTone(V2, "無色")).toBe("neutral")
  })

  it("值不在選項清單內 → neutral(不丟例外)", () => {
    expect(optionTone(V2, "已作廢")).toBe("neutral")
  })

  it("非字串值 / 無 choices → neutral", () => {
    expect(optionTone(V2, null)).toBe("neutral")
    expect(optionTone(V2, 42)).toBe("neutral")
    expect(optionTone(field({}), "待審")).toBe("neutral")
  })

  /* 安全(FMEA C1):色來自使用者輸入,只准回受控 tone。
     若哪天有人把這裡改成直接回傳 stored 值,這條會紅。 */
  it("🔴 非法色值不得原樣回傳 —— 只回受控 tone", () => {
    const evil = field({
      choices: [{ id: "oaaaaaaa5", name: "壞", color: "red; content: url(//evil)" }],
    })
    expect(optionTone(evil, "壞")).toBe("neutral")
  })

  /* v1 已由 migration 0027 轉換、後端 schema 寫入時亦剝除,不該再被支援 ——
     留著相容分支只會讓「色設定該存哪」變成兩個真相。 */
  it("v1 的 colors side map **不**再被讀取(結構已淘汰)", () => {
    const v1 = field({ choices: ["待審"], colors: { 待審: "warn" } })
    expect(optionTone(v1, "待審")).toBe("neutral")
  })
})

describe("isChipField / chipValues", () => {
  it("單選與多選皆以章呈現", () => {
    expect(isChipField(V2)).toBe(true)
    expect(isChipField({ ...V2, type: "multiSelect" })).toBe(true)
    expect(isChipField({ ...V2, type: "text" })).toBe(false)
  })

  it("多選攤成陣列;空值不產生空章", () => {
    expect(chipValues(["甲", "乙"])).toEqual(["甲", "乙"])
    expect(chipValues("甲")).toEqual(["甲"])
    expect(chipValues("")).toEqual([])
    expect(chipValues(null)).toEqual([])
  })
})
