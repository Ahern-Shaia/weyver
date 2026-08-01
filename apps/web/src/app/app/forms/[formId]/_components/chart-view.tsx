"use client"

import { Select } from "@weyver/ui/select"
import { type ReactNode, useMemo, useState } from "react"
import { Chart, type ChartOption } from "@/components/chart"
import { type RecordQuery, useGroupStats } from "@/lib/engine/hooks"
import { GROUP_AGGREGATE_FNS, type FormDto } from "@/lib/engine/schemas"

/* 🔴 F-2 M3 檢視級圖表。

   **與 pivot 共用 spec、分岔執行**|圖表走**單一 group-by**(即既有的 group-stats),
   pivot 才走 GROUPING SETS 取小計。硬綁成同一查詢會讓圖表背上 pivot 的多查詢成本
   —— Metabase #13573 正是這個下場。

   **維度值即資料**|圖例、軸標籤、tooltip 會把 GROUP BY 的維度值全部列舉。
   本元件的資料來自 group-stats,而它與列表跑在同一個受 RLS 約束的 role,
   故只會列出使用者看得到的值。**不得改從選項定義或快取取維度清單**(CVE-2024-55951)。 */

const CHART_TYPES = [
  { value: "bar", label: "長條圖" },
  { value: "line", label: "折線圖" },
  { value: "pie", label: "圓餅圖" },
] as const
type ChartType = (typeof CHART_TYPES)[number]["value"]

const AGG_LABEL: Record<string, string> = {
  count: "計數",
  empty: "空白",
  filled: "已填",
  sum: "加總",
  avg: "平均",
  min: "最小",
  max: "最大",
}

export function ChartView({
  formId,
  form,
}: {
  readonly formId: number
  readonly form: FormDto
}): ReactNode {
  const groupable = form.fields.filter(
    (f) => !["attachment", "image", "signature", "link"].includes(f.type),
  )
  const numeric = form.fields.filter((f) =>
    ["number", "money", "percent", "rating"].includes(f.type),
  )

  const [type, setType] = useState<ChartType>("bar")
  const [dimension, setDimension] = useState(groupable[0]?.name ?? "")
  const [measure, setMeasure] = useState<{ field: string; fn: string } | null>(null)

  const query = useMemo<RecordQuery>(
    () => ({
      filters: [],
      combinator: "and",
      sort: [],
      groupBy: dimension === "" ? [] : [{ field: dimension, dir: "asc" }],
    }),
    [dimension],
  )
  const { data, isPending } = useGroupStats(formId, query, measure === null ? [] : [measure])

  const points = useMemo(() => {
    const measureKey = measure === null ? null : `${measure.fn}:${measure.field}`
    return (data?.groups ?? [])
      .filter((g) => g.depth === 1)
      .map((g) => {
        const raw = measureKey === null ? g.count : g.aggregates[measureKey]
        return {
          name: g.keys[0] ?? "(空白)",
          value: raw === null || raw === undefined ? 0 : Number(raw),
        }
      })
  }, [data, measure])

  const option = useMemo<ChartOption>(() => {
    const valueLabel =
      measure === null ? "筆數" : `${AGG_LABEL[measure.fn] ?? measure.fn} ${measure.field}`
    /* 🔴 自訂 aria 描述而非用 ECharts 自動生成。
       實走發現:直角座標系下自動描述會把「分類索引, 值」一起唸出來
       (「中 為 0,300」—— 0 是 x 軸索引),對螢幕閱讀器是錯誤資訊。
       改法試過帶 {name,value} 仍無效(category 軸下它把整個 value 當座標對)。
       故關掉自動描述、自己組一句正確的;`decal` 色盲紋理仍保留。 */
    const ariaDesc = `${valueLabel}依${points.length}個分類:${points
      .map((p) => `${p.name} ${String(p.value)}`)
      .join("、")}`
    const ariaOpt = {
      aria: { enabled: true, decal: { show: true }, label: { description: ariaDesc } },
    }

    if (type === "pie") {
      return {
        ...ariaOpt,
        tooltip: { trigger: "item" },
        legend: { bottom: 0, type: "scroll" },
        series: [{ type: "pie", radius: "62%", data: points, name: valueLabel }],
      }
    }
    return {
      ...ariaOpt,
      tooltip: { trigger: "axis" },
      grid: { left: 48, right: 16, top: 24, bottom: 56 },
      xAxis: { type: "category", data: points.map((p) => p.name), axisLabel: { rotate: 30 } },
      yAxis: { type: "value" },
      series: [{ type, data: points.map((p) => p.value), name: valueLabel }],
    }
  }, [type, points, measure])

  if (groupable.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-[12px] text-ink-3">
        此表單沒有可分析的欄位。
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-card px-4 py-1.5">
        <span className="text-[12px] text-ink-2">圖表</span>
        <Select
          className="h-7 w-24"
          aria-label="圖表類型"
          value={type}
          onChange={(e) => setType(e.target.value as ChartType)}
        >
          {CHART_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-ink-2">分類</span>
        <Select
          className="h-7 w-28"
          aria-label="圖表分類欄位"
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
        >
          {groupable.map((f) => (
            <option key={f.id} value={f.name}>
              {f.name}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-ink-2">值</span>
        <Select
          className="h-7 w-28"
          aria-label="圖表值欄位"
          value={measure?.field ?? ""}
          onChange={(e) =>
            setMeasure(
              e.target.value === "" ? null : { field: e.target.value, fn: measure?.fn ?? "sum" },
            )
          }
        >
          <option value="">筆數</option>
          {numeric.map((f) => (
            <option key={f.id} value={f.name}>
              {f.name}
            </option>
          ))}
        </Select>
        {measure === null ? null : (
          <Select
            className="h-7 w-24"
            aria-label="圖表聚合方式"
            value={measure.fn}
            onChange={(e) => setMeasure({ ...measure, fn: e.target.value })}
          >
            {GROUP_AGGREGATE_FNS.map((fn) => (
              <option key={fn} value={fn}>
                {AGG_LABEL[fn] ?? fn}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isPending ? (
          <div className="py-10 text-center text-[12px] text-ink-3">計算中…</div>
        ) : points.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-ink-3">無資料可繪製。</div>
        ) : (
          <>
            <Chart
              option={option}
              ariaLabel={`${dimension}的${measure === null ? "筆數" : measure.field}${
                CHART_TYPES.find((t) => t.value === type)?.label ?? ""
              }`}
            />
            {/* 🔴 圖表旁提供資料表 —— ECharts 的鍵盤導覽有已知缺陷(#18585),
                純圖形對螢幕閱讀器使用者不可用,資料表是可靠的等價途徑。 */}
            <table className="mt-4 w-full max-w-md border-collapse text-[12px]">
              <caption className="pb-1 text-left text-[12px] text-ink-3">圖表資料</caption>
              <thead>
                <tr>
                  <th className="border border-cell bg-head px-2 py-1 text-left text-ink-2">
                    {dimension}
                  </th>
                  <th className="border border-cell bg-head px-2 py-1 text-right text-ink-2">
                    {measure === null ? "筆數" : measure.field}
                  </th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.name}>
                    <td className="border border-cell px-2 py-1 text-ink">{p.name}</td>
                    <td className="border border-cell px-2 py-1 text-right font-mono text-ink">
                      {p.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
