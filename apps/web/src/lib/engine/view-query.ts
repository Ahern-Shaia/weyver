import { operatorNeedsValue } from "./field-filters"
import type { RecordQuery } from "./hooks"
import type { ViewConfig } from "./schemas"

/* 🔴 R1|由「目前的檢視設定」推導查詢條件 —— **列表 / 樞紐 / 圖表共用同一份**。

   在此之前這段邏輯只寫在 `collection-view.tsx` 裡,而 `form-workspace.tsx`
   傳給樞紐的是**寫死的空 filter**(`{ filters: [], combinator: "and", sort: [] }`)。
   後果是 OQ-PC-10 = A 明文要避免的那件事:
   **列表篩成「本月南區」,切到樞紐 / 圖表卻顯示全年全區,而畫面沒有任何提示。**
   那不是少一個功能,是**那張圖在騙人**。

   抽成共用函式而不是把 query 傳來傳去,是因為**漂移正是複製造成的** ——
   兩份各自演化過一次就再也對不回來,而且不會有任何技術訊號。 */
export function buildRecordQuery(input: {
  readonly view: ViewConfig | null
  readonly quickSearch: string
  readonly collapsed?: readonly (readonly string[])[]
}): RecordQuery {
  const { view, quickSearch, collapsed } = input
  return {
    /* 跳過未填值的條件(避免 op 需值但空 → 後端 422;亦即「輸入前不套用」) */
    filters: (view?.filter.conditions ?? []).filter(
      (c) =>
        !operatorNeedsValue(c.op) || (c.value !== "" && c.value !== null && c.value !== undefined),
    ),
    combinator: view?.filter.combinator ?? "and",
    sort: view?.sorts ?? [],
    q: quickSearch.trim() || view?.search || undefined,
    groupBy: view?.groupBy ?? [],
    collapsed: collapsed ?? [],
  }
}

/* 目前是否套著任何會縮小資料範圍的條件。
   用於**告訴使用者這張圖只涵蓋一部分資料** —— 圖表最容易被當成全貌。 */
export function isNarrowed(query: RecordQuery): boolean {
  return (query.filters?.length ?? 0) > 0 || (query.q ?? "") !== ""
}

/* 🔴 OQ-PC-10 = A|小圖表的篩選優先序(Ragic doc/122 逐字):

   | 位置 | 優先序 |
   |---|---|
   | **列表頁** | 固定篩選 > **自訂篩選及共通篩選** > 小圖表本身的篩選 |
   | 表單頁 / 首頁 | 固定篩選 > 小圖表本身的篩選(**沒有中間那層**)|

   「優先序」不是「全部 AND」——**同一個欄位上,高優先者取代低優先者**。
   全部 AND 的話「檢視篩南區、圖自己篩北區」會得到空集合,
   而使用者看到的是一張空圖,他不會知道那是兩層條件打架。

   ⚠️ 不同欄位仍然一起套用(兩者都成立才顯示)—— 那不是衝突,是疊加。 */
type FilterCondition = NonNullable<RecordQuery["filters"]>[number]

export function mergeWidgetFilter(
  viewQuery: RecordQuery,
  ownFilter: readonly FilterCondition[],
  placement: "list" | "form",
): RecordQuery {
  /* 表單頁沒有「使用者篩選」那一層 → 只留 widget 自己的(連快速搜尋都不吃) */
  if (placement === "form") return { ...viewQuery, filters: [...ownFilter], q: undefined }

  const higherFields = new Set((viewQuery.filters ?? []).map((f) => f.field))
  const kept = ownFilter.filter((c) => !higherFields.has(c.field))
  return { ...viewQuery, filters: [...(viewQuery.filters ?? []), ...kept] }
}
