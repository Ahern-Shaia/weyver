import { describe, expect, it } from "vitest"
import { resolveClientLevel } from "./notification-levels"

/* 🔴 audit-D §3-9|前端的層級解析原本**只有兩層**(表單 → 租戶),
   而後端 `notification.service.resolveLevel` 是三層(表單 → 分類 → 租戶)。

   後果不是少一個功能,是**畫面說的與系統做的不是同一件事**:
   設了分類層的租戶,設定頁把那些表單顯示成「跟著全租戶預設」,
   而實際發出的通知走的是分類層。

   這一組測試釘的就是「兩邊同一套繼承序」。 */
const pref = (scope: "tenant" | "category" | "form", scopeId: number | null, level: number) => ({
  scope,
  scopeId,
  level,
  customEvents: null,
})

describe("resolveClientLevel", () => {
  it("表單自己設的最優先", () => {
    const prefs = [pref("tenant", null, 1), pref("category", 7, 2), pref("form", 10, 3)]
    expect(resolveClientLevel(prefs, 10, 7)).toMatchObject({ level: 3, inherited: false })
  })

  it("🔴 表單沒設 → 落到**分類**,不是直接跳到租戶", () => {
    const prefs = [pref("tenant", null, 1), pref("category", 7, 2)]
    expect(resolveClientLevel(prefs, 10, 7)).toMatchObject({
      level: 2,
      inherited: true,
      from: "category",
    })
  })

  it("分類也沒設 → 租戶", () => {
    const prefs = [pref("tenant", null, 1), pref("category", 8, 2)]
    expect(resolveClientLevel(prefs, 10, 7)).toMatchObject({ level: 1, from: "tenant" })
  })

  it("未分類的表單不得誤吃別人的分類設定", () => {
    const prefs = [pref("tenant", null, 1), pref("category", 7, 2)]
    expect(resolveClientLevel(prefs, 10, null)).toMatchObject({ level: 1, from: "tenant" })
  })

  it("什麼都沒設 → 預設值,且標為繼承", () => {
    expect(resolveClientLevel([], 10, 7)).toMatchObject({ inherited: true, from: "tenant" })
  })
})
