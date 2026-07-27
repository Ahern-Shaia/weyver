"use client"

import { useReverseRelations } from "@/lib/engine/hooks"
import type { FieldDto, RecordRow } from "@/lib/engine/schemas"
import { ArrowUpRight, Link2 } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

/* R1·workbench-uplift A3(OQ-RWB-4=B)|關聯 rail。
   **正向**(本筆的 link 欄指向誰)由記錄值直接得出,零請求;
   **反向**(本筆被哪些記錄引用)走 `/relations` 端點,無權來源表整組不回(後端已擋)。
   兩者皆只給導航,不展開對方內容 —— 點進去才走完整權限路徑。 */
export function RelationRail({
  formId,
  record,
  fields,
}: {
  readonly formId: number
  readonly record: RecordRow
  readonly fields: readonly FieldDto[]
}): ReactNode {
  const { data: groups = [], isLoading } = useReverseRelations(formId, record.id)

  const outgoing = fields
    .filter((f) => f.type === "link")
    .map((f) => {
      const targetFormId = (f.options as { targetFormId?: number }).targetFormId
      const value = record.values[f.name]
      const targetId = typeof value === "number" ? value : Number(value)
      return { field: f, targetFormId, targetId }
    })
    .filter(
      (o) => o.targetFormId !== undefined && Number.isSafeInteger(o.targetId) && o.targetId > 0,
    )

  if (outgoing.length === 0 && groups.length === 0 && !isLoading) return null

  return (
    <section className="mt-4 border-t border-line pt-4" data-noprint>
      <h4 className="mb-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-3">
        <Link2 size={12} strokeWidth={1.9} />
        關聯記錄
      </h4>

      {outgoing.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1 text-[10px] text-ink-4">本筆引用</div>
          <ul className="flex flex-col gap-1">
            {outgoing.map((o) => (
              <li key={o.field.id}>
                <Link
                  href={`/app/forms/${String(o.targetFormId)}?mode=record&rid=${o.targetId}`}
                  className="flex items-center gap-1.5 text-[12px] text-primary hover:underline"
                >
                  <span className="text-ink-4">{o.field.name}</span>
                  <ArrowUpRight size={11} strokeWidth={1.9} />
                  <span className="font-mono">#{o.targetId}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isLoading ? (
        <div className="text-[11.5px] text-ink-4">載入關聯…</div>
      ) : (
        groups.map((g) => (
          <div key={`${g.formId}-${g.viaFieldName}`} className="mb-3">
            <div className="mb-1 text-[10px] text-ink-4">
              被 <span className="text-ink-3">{g.formName}</span> 引用(經 {g.viaFieldName})
            </div>
            <ul className="flex flex-col gap-1">
              {g.records.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/app/forms/${g.formId}?mode=record&rid=${r.id}`}
                    className="flex items-center gap-1.5 text-[12px] text-primary hover:underline"
                  >
                    <ArrowUpRight size={11} strokeWidth={1.9} />
                    <span className="truncate">{r.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {g.truncated ? (
              <div className="mt-1 text-[10.5px] text-ink-4">僅顯示前 20 筆</div>
            ) : null}
          </div>
        ))
      )}
    </section>
  )
}
