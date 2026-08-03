import { describe, expect, it } from "vitest"
import type { ViewConfig } from "./schemas"
import { buildRecordQuery, isNarrowed, mergeWidgetFilter } from "./view-query"

const view = (o: Partial<ViewConfig> = {}): ViewConfig =>
  ({
    fields: [],
    filter: { combinator: "and", conditions: [] },
    sorts: [],
    groupBy: [],
    ...o,
  }) as ViewConfig

describe("buildRecordQuery", () => {
  /* 🔴 這一條是整個檔存在的理由:樞紐 / 圖表原本收到寫死的空 filter,
     於是列表篩成「本月南區」、圖表卻畫全年全區 —— 那張圖在騙人(OQ-PC-10=A)。 */
  it("帶出檢視的篩選條件,而不是空的", () => {
    const q = buildRecordQuery({
      view: view({
        filter: { combinator: "and", conditions: [{ field: "區域", op: "eq", value: "南區" }] },
      }),
      quickSearch: "",
    })
    expect(q.filters).toHaveLength(1)
    expect(q.combinator).toBe("and")
  })

  /* 「輸入前不套用」—— 需要值的運算子還沒填值時跳過,否則後端 422 */
  it("需值的運算子未填值時跳過該條件", () => {
    const q = buildRecordQuery({
      view: view({
        filter: {
          combinator: "and",
          conditions: [
            { field: "區域", op: "eq", value: "" },
            { field: "狀態", op: "isEmpty" },
          ],
        },
      }),
      quickSearch: "",
    })
    /* isEmpty 不需值 → 留下;eq 需值但空 → 跳過 */
    expect(q.filters?.map((f) => f.field)).toEqual(["狀態"])
  })

  it("快速搜尋優先於檢視內存的搜尋字串", () => {
    const q = buildRecordQuery({ view: view({ search: "存起來的" }), quickSearch: " 現打的 " })
    expect(q.q).toBe("現打的")
  })

  it("沒有檢視時回空條件,不炸", () => {
    expect(buildRecordQuery({ view: null, quickSearch: "" }).filters).toEqual([])
  })
})

describe("isNarrowed", () => {
  /* 圖表最容易被當成全貌 —— 套著條件時要講出來 */
  it("有篩選或搜尋才算縮小了範圍", () => {
    expect(isNarrowed({ filters: [], combinator: "and", sort: [] })).toBe(false)
    expect(
      isNarrowed({
        filters: [{ field: "a", op: "eq", value: "1" }],
        combinator: "and",
        sort: [],
      }),
    ).toBe(true)
    expect(isNarrowed({ filters: [], combinator: "and", sort: [], q: "找" })).toBe(true)
  })

  /* 排序不縮小範圍 —— 只是換順序,不該觸發「僅涵蓋部分資料」的警語 */
  it("只有排序不算縮小", () => {
    expect(isNarrowed({ filters: [], combinator: "and", sort: [{ field: "a", dir: "asc" }] })).toBe(
      false,
    )
  })
})

/* 🔴 OQ-PC-10 = A|小圖表的篩選優先序(Ragic doc/122)。

   「優先序」不是「全部 AND」—— 同一個欄位上,高優先者**取代**低優先者。
   全部 AND 的話「檢視篩南區、圖自己篩北區」會得到空集合,
   而使用者看到一張空圖,他不會知道那是兩層條件打架。 */
describe("mergeWidgetFilter", () => {
  const base = {
    combinator: "and" as const,
    sort: [],
  }
  const cond = (field: string, value: string) => ({ field, op: "eq" as const, value })

  it("🔴 同欄位衝突時,檢視的篩選勝過 widget 自己的", () => {
    const merged = mergeWidgetFilter(
      { ...base, filters: [cond("區域", "南區")] },
      [cond("區域", "北區")],
      "list",
    )
    expect(merged.filters).toEqual([cond("區域", "南區")])
  })

  /* 不同欄位不是衝突,是疊加 —— 兩者都成立才顯示 */
  it("不同欄位兩者都套用", () => {
    const merged = mergeWidgetFilter(
      { ...base, filters: [cond("區域", "南區")] },
      [cond("狀態", "已結案")],
      "list",
    )
    expect(merged.filters).toHaveLength(2)
  })

  /* 表單頁 / 首頁**沒有中間那層**(Ragic 明列)—— 不能與列表頁共用一條路 */
  it("🔴 表單頁不吃使用者的篩選與搜尋,只吃 widget 自己的", () => {
    const merged = mergeWidgetFilter(
      { ...base, filters: [cond("區域", "南區")], q: "關鍵字" },
      [cond("狀態", "已結案")],
      "form",
    )
    expect(merged.filters).toEqual([cond("狀態", "已結案")])
    expect(merged.q).toBeUndefined()
  })
})
