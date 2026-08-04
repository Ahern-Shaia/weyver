import { describe, expect, it } from "vitest"
import { allowedChoices, asSelectOptions, isChoiceAllowed } from "./cascading"

/* 🔴 audit-D §2.4|連動選項此前**只有 schema**:設計器沒有入口、填單不過濾、
   後端不驗 —— 打 API 設了也不會有任何效果。

   這一組測試釘的是三條判準,以及**最容易漏的那一層**:
   `parents` 存的是父選項的 **id**,而記錄裡存的是選項**名稱**。 */
const parent = asSelectOptions({
  choices: [
    { id: "o11111111", name: "飲料" },
    { id: "o22222222", name: "食品" },
  ],
})
const child = asSelectOptions({
  parentField: "大類",
  choices: [
    { id: "oaaaaaaaa", name: "紅茶", parents: ["o11111111"] },
    { id: "obbbbbbbb", name: "餅乾", parents: ["o22222222"] },
    { id: "occcccccc", name: "其他" },
    { id: "odddddddd", name: "已停售", parents: ["o11111111"], retired: true },
  ],
})

describe("allowedChoices", () => {
  it("🔴 依父欄的**名稱**解回 id 再比對", () => {
    expect(allowedChoices(child, parent, "飲料").map((c) => c.name)).toEqual(["紅茶", "其他"])
    expect(allowedChoices(child, parent, "食品").map((c) => c.name)).toEqual(["餅乾", "其他"])
  })

  it("父欄沒填 → 只剩不受限的選項(先選大類才選得到小類)", () => {
    expect(allowedChoices(child, parent, "").map((c) => c.name)).toEqual(["其他"])
    expect(allowedChoices(child, parent, null).map((c) => c.name)).toEqual(["其他"])
  })

  it("沒設 parentField → 全部可選(沒有連動這回事)", () => {
    const plain = asSelectOptions({ choices: child.choices })
    expect(allowedChoices(plain, parent, "").map((c) => c.name)).toEqual(["紅茶", "餅乾", "其他"])
  })

  it("停用的選項一律不出現在可選集合", () => {
    expect(allowedChoices(child, parent, "飲料").map((c) => c.name)).not.toContain("已停售")
  })

  it("父欄的值不在父選項裡(改名 / 髒資料)→ 視同沒選", () => {
    expect(allowedChoices(child, parent, "不存在的大類").map((c) => c.name)).toEqual(["其他"])
  })
})

describe("isChoiceAllowed(伺服器端)", () => {
  it("父子相符才放行", () => {
    expect(isChoiceAllowed(child, parent, "飲料", "紅茶")).toBe(true)
    expect(isChoiceAllowed(child, parent, "食品", "紅茶")).toBe(false)
    expect(isChoiceAllowed(child, parent, "", "紅茶")).toBe(false)
  })

  it("不受限的選項恆放行", () => {
    expect(isChoiceAllowed(child, parent, "", "其他")).toBe(true)
  })

  /* 🔴 停用的舊值不在這一關把關 —— 一筆老資料不該因為改了別的欄位就存不回去 */
  it("停用的既有值仍放行(軟停用的語意是新記錄不可選,不是舊值失效)", () => {
    expect(isChoiceAllowed(child, parent, "飲料", "已停售")).toBe(true)
  })

  it("不在 choices 裡的值不歸這裡管(型別驗證另有把關)", () => {
    expect(isChoiceAllowed(child, parent, "飲料", "不存在")).toBe(true)
  })
})

/* 🔴 `parents` 裡存的不保證是 id。v1 的 `optionParents` 在正規化時用的是
   **子欄自己的**名稱→id 對照表去查父選項名,查不到就原樣留下 ——
   於是舊資料存的是父選項的**名稱**。整合測試當場撞到這件事。 */
describe("v1 遺留:parents 存的是父選項名稱", () => {
  const legacyChild = asSelectOptions({
    parentField: "狀態",
    choices: [{ id: "oaaaaaaaa", name: "新A", parents: ["新"] }],
  })
  const statusParent = asSelectOptions({ choices: [{ id: "o11111111", name: "新" }] })

  it("以名稱存的 parents 一樣要生效(否則舊資料的連動靜默失效)", () => {
    expect(isChoiceAllowed(legacyChild, statusParent, "新", "新A")).toBe(true)
    expect(allowedChoices(legacyChild, statusParent, "新").map((c) => c.name)).toEqual(["新A"])
  })

  it("父值不符時仍然擋得住", () => {
    expect(isChoiceAllowed(legacyChild, statusParent, "結", "新A")).toBe(false)
  })
})
