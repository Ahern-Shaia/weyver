"use client"

import { useMemberNames } from "@/lib/engine/authz"
import {
  type RecordQuery,
  useGroupStats,
  useInfiniteRecordsQuery,
  useLinkLabels,
} from "@/lib/engine/hooks"
import type { FormDto } from "@/lib/engine/schemas"
import { Select } from "@weyver/ui/select"
import { type ReactNode, useMemo, useState } from "react"
import { KanbanView, canStackBy } from "./kanban-view"

/* Kanban 容器:選分欄欄位 + 取數。
   **stack = 單欄 group-by 的一階特例** → 每欄總筆數直接用 M1 的 group-stats,
   不另建一套計數路徑(共用即代表 RLS / 欄位級白名單也一併沿用)。 */
export function KanbanBoard({
  formId,
  form,
  onOpen,
}: {
  readonly formId: number
  readonly form: FormDto
  readonly onOpen: (id: number) => void
}): ReactNode {
  const stackable = form.fields.filter(canStackBy)
  const [stackName, setStackName] = useState<string>(stackable[0]?.name ?? "")
  const stackField = stackable.find((f) => f.name === stackName) ?? stackable[0]
  const memberNames = useMemberNames(form.fields)

  const query = useMemo<RecordQuery>(
    () => ({
      filters: [],
      combinator: "and",
      sort: [],
      groupBy: stackField === undefined ? [] : [{ field: stackField.name, dir: "asc" }],
    }),
    [stackField],
  )
  const recordsQuery = useInfiniteRecordsQuery(formId, query)
  const stats = useGroupStats(formId, query, [])
  const records = recordsQuery.data?.pages.flatMap((p) => p.records) ?? []
  /* audit-D §2.2|連結欄顯示標題而非 id;與列表 / 記錄頁同一支 */
  const linkLabels = useLinkLabels(formId, form.fields, records)

  /* 每欄總筆數以後端統計為準 —— 已載入的卡片可能少於總數(分頁) */
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of stats.data?.groups ?? []) {
      if (g.depth !== 1) continue
      m.set(g.keys[0] ?? "__uncategorized__", g.count)
    }
    return m
  }, [stats.data])

  if (stackable.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-ink-3">
        看板需要一個「單選」或「人員」欄位來分欄。
        <br />
        請先到設計器新增,例如「狀態」或「負責人」。
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-card px-4">
        <span className="text-[12px] text-ink-2">分欄依據</span>
        <div>
          <Select
            className="h-7 w-40"
            aria-label="看板分欄依據"
            value={stackField?.name ?? ""}
            onChange={(e) => setStackName(e.target.value)}
          >
            {stackable.map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
          </Select>
        </div>
        {recordsQuery.hasNextPage ? (
          <button
            type="button"
            onClick={() => void recordsQuery.fetchNextPage()}
            className="text-[12px] text-primary hover:underline"
          >
            載入更多卡片
          </button>
        ) : null}
      </div>

      {stackField === undefined ? null : (
        <KanbanView
          formId={formId}
          form={form}
          records={records}
          stackField={stackField}
          memberNames={memberNames}
          linkLabels={linkLabels}
          onOpen={onOpen}
          counts={counts}
        />
      )}
    </div>
  )
}
