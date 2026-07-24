"use client"

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Trash2 } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { fieldTypeMeta } from "@/lib/engine/field-types"
import { useDropField, useLayout, usePutLayout } from "@/lib/engine/hooks"
import type { FieldDto, FieldLayout, FormDto, Layout } from "@/lib/engine/schemas"

/* R1·UP-3 M2 2D 格線畫布(OQ-FD2-7=A 取代線性設計清單)。
   layout metadata 渲染於 CSS grid;拖曳(dnd-kit)重定位 → 草稿 → 「儲存版面」PUT(純 metadata,零 DDL)。
   既有表無 layout → 預設投影(每欄一列、半寬)。結構性刪欄維持即時 DDL(OQ-FD2-2,不入草稿)。 */

const COL_W = 52
const ROW_H = 60
const DEFAULT_SPAN = 6

const EMPTY_LAYOUT: Layout = { grid: { cols: 12 }, fields: {}, statics: [], sections: [] }

/* 有效 layout = 既存 layout + 為未定位欄位補預設位(每欄一列) */
function effectiveLayout(fields: readonly FieldDto[], layout: Layout | null): Layout {
  const base = layout ?? EMPTY_LAYOUT
  const map: Record<string, FieldLayout> = { ...base.fields }
  let maxRow = Object.values(map).reduce((m, f) => Math.max(m, f.row), -1)
  for (const f of fields) {
    if (map[String(f.id)] === undefined) {
      maxRow += 1
      map[String(f.id)] = { row: maxRow, col: 0, colSpan: DEFAULT_SPAN }
    }
  }
  return { ...base, fields: map }
}

export function DesignCanvas({
  formId,
  form,
}: {
  readonly formId: number
  readonly form: FormDto
}): ReactNode {
  const { data: layoutResp, isPending } = useLayout(formId)
  const putLayout = usePutLayout(formId)
  const dropField = useDropField(formId)
  const [draft, setDraft] = useState<Layout | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const serverLayout = layoutResp?.layout ?? null
  const effective = useMemo(
    () => effectiveLayout(form.fields, draft ?? serverLayout),
    [form.fields, draft, serverLayout],
  )
  const dirty = draft !== null
  const cols = effective.grid.cols

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const onDragEnd = (e: DragEndEvent): void => {
    const id = String(e.active.id)
    const cur = effective.fields[id]
    if (cur === undefined) return
    const dCol = Math.round(e.delta.x / COL_W)
    const dRow = Math.round(e.delta.y / ROW_H)
    if (dCol === 0 && dRow === 0) return
    const span = cur.colSpan ?? DEFAULT_SPAN
    const col = Math.max(0, Math.min(cols - span, cur.col + dCol))
    const row = Math.max(0, cur.row + dRow)
    setDraft({ ...effective, fields: { ...effective.fields, [id]: { ...cur, col, row } } })
  }

  const save = (): void => {
    if (draft === null) return
    putLayout.mutate(draft, {
      onSuccess: () => {
        setDraft(null)
        setMsg("版面已儲存")
      },
      onError: (e) => setMsg(describeEngineError(e)),
    })
  }

  const maxRow = Object.values(effective.fields).reduce((m, f) => Math.max(m, f.row), 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-card px-4 text-[12px]">
        <span className="font-semibold text-ink-2">版面設計</span>
        <span className="text-ink-4">拖曳欄位排版（純版面,不動資料）</span>
        {dirty ? <span className="text-[11px] text-warn">● 未儲存</span> : null}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || putLayout.isPending}
          className="ml-auto rounded-xs bg-primary px-3 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-primary-d disabled:opacity-40"
        >
          {putLayout.isPending ? "儲存中…" : "儲存版面"}
        </button>
      </div>
      {msg !== null ? (
        <div className="shrink-0 border-b border-line bg-label px-4 py-1.5 text-[11.5px] text-ink-2">
          {msg}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {isPending ? (
          <div className="text-[12px] text-ink-3">載入版面…</div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div
              className="relative"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, ${COL_W}px)`,
                gridAutoRows: `${ROW_H}px`,
                gap: "8px",
                width: cols * (COL_W + 8),
                minHeight: (maxRow + 2) * (ROW_H + 8),
              }}
            >
              {form.fields.map((f) => {
                const fl = effective.fields[String(f.id)]
                if (fl === undefined) return null
                return (
                  <FieldCard
                    key={f.id}
                    field={f}
                    layout={fl}
                    onDrop={() => dropField.mutate(f.id)}
                  />
                )
              })}
            </div>
          </DndContext>
        )}
      </div>
    </div>
  )
}

function FieldCard({
  field,
  layout,
  onDrop,
}: {
  readonly field: FieldDto
  readonly layout: FieldLayout
  readonly onDrop: () => void
}): ReactNode {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(field.id),
  })
  const span = layout.colSpan ?? DEFAULT_SPAN
  const meta = fieldTypeMeta(field.type)

  return (
    <div
      ref={setNodeRef}
      style={{
        gridColumn: `${layout.col + 1} / span ${span}`,
        gridRow: layout.row + 1,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : undefined,
        opacity: layout.hidden ? 0.5 : 1,
      }}
      className={`group flex overflow-hidden rounded-sm border bg-card ${
        isDragging ? "border-primary shadow-lg" : "border-line"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex w-6 shrink-0 cursor-grab items-center justify-center border-r border-line-2 bg-head text-ink-4 hover:text-primary active:cursor-grabbing"
        aria-label={`拖曳 ${field.name}`}
      >
        <GripVertical size={13} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-1">
        <div className="flex items-center gap-1 truncate text-[11.5px] font-medium text-ink">
          {field.required ? <span className="text-er">*</span> : null}
          <span className="truncate">{field.name}</span>
          {layout.hidden ? <span className="text-[9px] text-ink-4">（隱藏）</span> : null}
        </div>
        <div className="truncate font-mono text-[9.5px] text-ink-4">
          {meta.label}
          {layout.placeholder ? ` · ${layout.placeholder}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onDrop}
        className="flex w-6 shrink-0 items-center justify-center text-ink-4 opacity-0 hover:text-er group-hover:opacity-100"
        aria-label={`下架 ${field.name}`}
        title="下架欄位（即時,不可復原）"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}
