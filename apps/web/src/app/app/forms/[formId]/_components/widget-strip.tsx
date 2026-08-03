"use client"

import { Chart, type ChartOption } from "@/components/chart"
import { type RecordQuery, type Widget, useGroupStats, useWidgets } from "@/lib/engine/hooks"
import { mergeWidgetFilter } from "@/lib/engine/view-query"
import { type ReactNode, useMemo } from "react"

/* 🔴 F-2 M4|小圖表(widget)條。Ragic doc/122 形態:釘在列表頁 / 表單頁的小圖。

   **每個 widget 各自送查詢**,而不是共用一次 —— 因為每個的維度與自身篩選都不同。
   ⚠️ 這是 N+1 的形狀,但 widget 數量是**設計者手動釘上去的**(個位數),
   且各自可獨立快取;真正要防的 N+1 是隨資料量成長的那種。

   **不做拖曳排版**:`docs/10 §131` 記載的「拖拉排版」已查明有誤 ——
   Ragic 官方逐字「依據表單中的位置,從左到右、從上到下依序排列」。
   照抄一個競品沒有的東西不是 parity,是自己加的複雜度。 */
export function WidgetStrip({
  formId,
  viewQuery,
  placement,
}: {
  readonly formId: number
  readonly viewQuery: RecordQuery
  readonly placement: "list" | "form"
}): ReactNode {
  const widgets = useWidgets(formId, placement)
  if ((widgets.data?.length ?? 0) === 0) return null

  return (
    <div className="flex flex-wrap gap-2 border-b border-line bg-surface px-3 py-2">
      {widgets.data?.map((w) => (
        <WidgetCard key={w.id} formId={formId} widget={w} viewQuery={viewQuery} />
      ))}
    </div>
  )
}

function WidgetCard({
  formId,
  widget,
  viewQuery,
}: {
  readonly formId: number
  readonly widget: Widget
  readonly viewQuery: RecordQuery
}): ReactNode {
  /* 🔴 OQ-PC-10:列表頁的 widget **必須拿到當下 view 的 filter 一起送查詢**。
     同欄位衝突時檢視勝,不同欄位疊加(見 `mergeWidgetFilter`)。 */
  /* 🔴 不可用時把 `groupBy` 留空 —— `useGroupStats` 以此判斷不發查詢。
     不送的理由不只是省一次請求:送了也是 fail-closed,而那個錯誤會**蓋掉**
     我們想顯示的具名原因,使用者就只看到一個通用錯誤。 */
  const query = useMemo<RecordQuery>(
    () => ({
      ...mergeWidgetFilter(viewQuery, widget.ownFilter, widget.placement),
      groupBy: widget.unavailableReason === null ? [{ field: widget.dimension, dir: "asc" }] : [],
    }),
    [viewQuery, widget],
  )
  const { data, isPending } = useGroupStats(
    formId,
    query,
    widget.measure === null ? [] : [widget.measure],
  )

  const points = useMemo(() => {
    const key = widget.measure === null ? null : `${widget.measure.fn}:${widget.measure.field}`
    return (data?.groups ?? []).map((g) => ({
      name: String(g.keys[0] ?? "(空白)"),
      value: key === null ? g.count : Number(g.aggregates?.[key] ?? 0),
    }))
  }, [data, widget.measure])

  const option = useMemo<ChartOption>(() => {
    const base = {
      aria: { enabled: true, decal: { show: true } },
      tooltip: { trigger: widget.chartType === "pie" ? "item" : "axis" },
      grid: { left: 36, right: 8, top: 12, bottom: 24 },
    }
    if (widget.chartType === "pie") {
      return { ...base, series: [{ type: "pie", radius: "70%", data: points }] }
    }
    return {
      ...base,
      xAxis: { type: "category", data: points.map((p) => p.name) },
      yAxis: { type: "value" },
      series: [{ type: widget.chartType, data: points.map((p) => p.value) }],
    }
  }, [widget.chartType, points])

  return (
    <div className="w-64 rounded-md border border-line bg-card p-2">
      <div className="mb-1 truncate text-[12px] font-medium text-ink">{widget.name}</div>
      {widget.unavailableReason !== null ? (
        /* 🔴 OQ-PC-11:**具名理由,不是空白圖**(照 Salesforce)。
           空白圖會被當成「沒資料」,而使用者會據此做決策 —— 那是最糟的誤導。 */
        <p className="text-[12px] text-wn">{widget.unavailableReason}</p>
      ) : isPending ? (
        <div className="h-28 text-[12px] text-ink-3">載入…</div>
      ) : points.length === 0 ? (
        /* 「真的沒資料」與「不可用」**分開講** —— 講成同一句就分不出來了 */
        <div className="h-28 text-[12px] text-ink-3">目前的篩選下沒有資料</div>
      ) : (
        <Chart option={option} height={112} ariaLabel={`${widget.name} 圖表`} />
      )}
    </div>
  )
}
