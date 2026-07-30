import { beforeEach, describe, expect, it } from "vitest"
import { readRecentFormIds, recordFormVisit } from "./recent-forms"

describe("最近使用的表單", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("最新開的排最前,重開會提前而不重複", () => {
    recordFormVisit("t1", 1)
    recordFormVisit("t1", 2)
    recordFormVisit("t1", 1)
    expect(readRecentFormIds("t1")).toEqual([1, 2])
  })

  it("上限 8 筆,超出丟最舊的", () => {
    for (let i = 1; i <= 12; i += 1) recordFormVisit("t1", i)
    const ids = readRecentFormIds("t1")
    expect(ids).toHaveLength(8)
    expect(ids[0]).toBe(12)
    expect(ids).not.toContain(1)
  })

  /* 🔴 FMEA U5(P0)|localStorage 跨分頁共用,而分頁可能各自停在不同公司。
     key 不帶租戶等於重犯 F-10 的錯。 */
  it("不同租戶互不可見", () => {
    recordFormVisit("orgA", 101)
    recordFormVisit("orgB", 202)
    expect(readRecentFormIds("orgA")).toEqual([101])
    expect(readRecentFormIds("orgB")).toEqual([202])
  })

  it("localStorage 內容壞掉時回空陣列,不擲錯", () => {
    window.localStorage.setItem("weyver.recent.t1", "{ 不是 JSON")
    expect(readRecentFormIds("t1")).toEqual([])
  })

  it("非整數內容被濾除(防手改 localStorage 塞進奇怪東西)", () => {
    window.localStorage.setItem("weyver.recent.t1", JSON.stringify([1, "2", null, 3.5, 4]))
    expect(readRecentFormIds("t1")).toEqual([1, 4])
  })
})
