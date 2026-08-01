import { describe, expect, it } from "vitest"
import { isReadOnlyExemptPath } from "./export-gate.js"

/* 🔴 停權租戶的匯出豁免。錯一邊各有代價:
   · 漏放行 → 停權客戶拿不回自己的資料,而那是停權訊息裡逐字承諾的事
   · 放太寬 → 停權形同虛設(停權的語意是「不得**變更**」,不是「不得使用」) */

describe("🔴 唯讀豁免清單", () => {
  it("匯出端點放行", () => {
    expect(isReadOnlyExemptPath("/api/exports")).toBe(true)
    expect(isReadOnlyExemptPath("/api/exports/12")).toBe(true)
    expect(isReadOnlyExemptPath("/api/exports?limit=5")).toBe(true)
  })

  it("其餘寫入照擋", () => {
    expect(isReadOnlyExemptPath("/api/forms")).toBe(false)
    expect(isReadOnlyExemptPath("/api/forms/1/records")).toBe(false)
    expect(isReadOnlyExemptPath("/api/settings/tenant")).toBe(false)
  })

  /* 🔴 前綴必須以 `/` 為界。寫鬆一點的話,日後任何 `/api/exportsXxx`
     都會意外取得停權豁免 —— 而那是沒有人會去檢查的一條路。 */
  it("🔴 相似前綴不得誤放行", () => {
    expect(isReadOnlyExemptPath("/api/exportsfoo")).toBe(false)
    expect(isReadOnlyExemptPath("/api/exports-admin")).toBe(false)
  })
})

/* 🔴 guard 拿到的 request 形狀不由本函式決定。既有的計費守衛測試用最小假物件、
   沒有 `url` —— 加這條閘門時整套跑出 4 條紅燈,錯誤是 `.split of undefined`。
   缺值一律 fail-closed。 */
it("🔴 path 為 undefined 時不豁免(fail-closed)", () => {
  expect(isReadOnlyExemptPath(undefined)).toBe(false)
})
