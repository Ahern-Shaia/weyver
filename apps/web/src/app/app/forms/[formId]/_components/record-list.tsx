"use client"

import type { ReactNode } from "react"
import type { FieldDto, RecordRow } from "@/lib/engine/schemas"

/* 工作台左欄:記錄清單(常駐,審一批不換頁)。標題取首欄值,fallback #id。 */
export function titleOf(record: RecordRow, fields: readonly FieldDto[]): string {
  const first = fields[0]
  const v = first ? record.values[first.name] : undefined
  return v !== undefined && v !== null && v !== "" ? String(v) : `記錄 #${record.id}`
}

export function RecordList({
  formName,
  fields,
  records,
  loading,
  selectedId,
  onSelect,
}: {
  readonly formName: string
  readonly fields: readonly FieldDto[]
  readonly records: readonly RecordRow[]
  readonly loading: boolean
  readonly selectedId: number | null
  readonly onSelect: (id: number) => void
}): ReactNode {
  return (
    <div data-noprint className="flex w-60 shrink-0 flex-col border-r border-line bg-card">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <b className="truncate text-[12.5px] font-semibold">{formName}</b>
        <span className="ml-auto rounded-xs border border-line px-1.5 font-mono text-[10px] text-ink-3">
          {records.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-2 text-[11.5px] text-ink-4">載入記錄…</div>
        ) : records.length === 0 ? (
          <div className="px-3 py-3 text-[11.5px] text-ink-4">尚無記錄。</div>
        ) : (
          records.map((r) => {
            const active = selectedId === r.id
            return (
              <button
                type="button"
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={
                  active
                    ? "block w-full border-b border-line-2 border-l-2 border-l-primary bg-primary-t px-3 py-2 text-left"
                    : "block w-full border-b border-line-2 border-l-2 border-l-transparent px-3 py-2 text-left hover:bg-surface"
                }
              >
                <div className="truncate text-[12px] font-medium text-ink">
                  {titleOf(r, fields)}
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">#{r.id}</div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
