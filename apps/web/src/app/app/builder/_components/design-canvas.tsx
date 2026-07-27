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
import {
  GripVertical,
  Image as ImageIcon,
  Redo2,
  Rows3,
  Trash2,
  Type,
  Printer,
  Undo2,
  Zap,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { fieldTypeMeta } from "@/lib/engine/field-types"
import { useDropField, useLayout, usePutLayout } from "@/lib/engine/hooks"
import type {
  FieldDto,
  FieldLayout,
  FormDto,
  Layout,
  LayoutPrint,
  StaticElement,
} from "@/lib/engine/schemas"
import { ActionsDesigner } from "./actions-designer"
import { PrintSettingsPanel } from "./print-settings-panel"
import { FieldSettingsPanel, StaticSettingsPanel } from "./field-settings-panel"

/* R1·UP-3 M2+M3 2D 格線畫布(OQ-FD2-7=A)。layout metadata → CSS grid;dnd-kit 拖曳重定位;
   欄位設定 / 靜態元素(文字·圖片)/ 分段 皆 layout 草稿;「儲存版面」PUT(純 metadata,零 DDL)。 */

const COL_W = 52
const ROW_H = 60
const DEFAULT_SPAN = 6
const EMPTY_LAYOUT: Layout = { grid: { cols: 12 }, fields: {}, statics: [], sections: [] }

type Selected = { type: "field"; id: string } | { type: "static"; id: string } | null

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

function nextStaticId(statics: readonly StaticElement[]): string {
  const nums = statics.map((s) => Number(s.id.replace(/\D/g, "")) || 0)
  return `st${Math.max(0, ...nums) + 1}`
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
  // 設計草稿 = 時間軸(hist[idx]);idx<0 = 乾淨(= 已存 baseline)。Ctrl+Z 沿時間軸移動(OQ-FD2-2)
  const [hist, setHist] = useState<Layout[]>([])
  const [idx, setIdx] = useState(-1)
  const [selected, setSelected] = useState<Selected>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [showPrint, setShowPrint] = useState(false)
  const histRef = useRef<Layout[]>([])
  histRef.current = hist

  const serverLayout = layoutResp?.layout ?? null
  const baseline = useMemo(
    () => effectiveLayout(form.fields, serverLayout),
    [form.fields, serverLayout],
  )
  const effective = idx < 0 ? baseline : (hist[idx] ?? baseline)
  const dirty = idx >= 0
  const canRedo = idx < hist.length - 1
  const cols = effective.grid.cols
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const edit = (next: Layout): void => {
    setHist((h) => [...h.slice(0, idx + 1), next])
    setIdx((i) => i + 1)
  }
  const undo = useCallback(() => setIdx((i) => Math.max(-1, i - 1)), [])
  const redo = useCallback(() => setIdx((i) => Math.min(histRef.current.length - 1, i + 1)), [])

  // Ctrl+Z / Ctrl+Shift+Z（結構性 DDL 操作不入此軸,OQ-FD2-2）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo, redo])

  // 未存離開警示(F6)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  const patchField = (id: string, patch: Partial<FieldLayout>): void => {
    const cur = effective.fields[id]
    if (cur === undefined) return
    edit({ ...effective, fields: { ...effective.fields, [id]: { ...cur, ...patch } } })
  }
  const patchStatic = (id: string, patch: Partial<StaticElement>): void =>
    edit({
      ...effective,
      statics: effective.statics.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })
  const addStatic = (kind: "text" | "image"): void => {
    const maxRow = Object.values(effective.fields).reduce((m, f) => Math.max(m, f.row), -1)
    const id = nextStaticId(effective.statics)
    const el: StaticElement = {
      id,
      kind,
      row: maxRow + 1,
      col: 0,
      colSpan: kind === "text" ? 6 : 3,
      ...(kind === "text" ? { text: "說明文字" } : {}),
    }
    edit({ ...effective, statics: [...effective.statics, el] })
    setSelected({ type: "static", id })
  }
  const removeStatic = (id: string): void => {
    edit({ ...effective, statics: effective.statics.filter((s) => s.id !== id) })
    setSelected(null)
  }
  const addSection = (): void => {
    const name = window.prompt("分段名稱")
    if (name === null || name.trim() === "") return
    const maxRow = Object.values(effective.fields).reduce((m, f) => Math.max(m, f.row), 0)
    const id = `sec${effective.sections.length + 1}`
    edit({
      ...effective,
      sections: [...effective.sections, { id, name: name.trim(), fromRow: 0, toRow: maxRow }],
    })
  }

  const save = (): void => {
    if (idx < 0) return
    putLayout.mutate(effective, {
      onSuccess: () => {
        setHist([])
        setIdx(-1)
        setMsg("版面已儲存")
      },
      onError: (e) => setMsg(describeEngineError(e)),
    })
  }

  const onDragEnd = (e: DragEndEvent): void => {
    const raw = String(e.active.id)
    const dCol = Math.round(e.delta.x / COL_W)
    const dRow = Math.round(e.delta.y / ROW_H)
    if (dCol === 0 && dRow === 0) return
    if (raw.startsWith("f:")) {
      const id = raw.slice(2)
      const cur = effective.fields[id]
      if (cur === undefined) return
      const span = cur.colSpan ?? DEFAULT_SPAN
      patchField(id, {
        col: Math.max(0, Math.min(cols - span, cur.col + dCol)),
        row: Math.max(0, cur.row + dRow),
      })
    } else if (raw.startsWith("s:")) {
      const id = raw.slice(2)
      const cur = effective.statics.find((s) => s.id === id)
      if (cur === undefined) return
      const span = cur.colSpan ?? 4
      patchStatic(id, {
        col: Math.max(0, Math.min(cols - span, cur.col + dCol)),
        row: Math.max(0, cur.row + dRow),
      })
    }
  }

  const maxRow = Object.values(effective.fields).reduce((m, f) => Math.max(m, f.row), 0)
  const selField =
    selected?.type === "field" ? form.fields.find((f) => String(f.id) === selected.id) : undefined
  const selStatic =
    selected?.type === "static" ? effective.statics.find((s) => s.id === selected.id) : undefined

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-card px-4 text-[12px]">
          <span className="font-semibold text-ink-2">版面設計</span>
          <TB onClick={() => addStatic("text")} icon={<Type size={13} />}>
            文字
          </TB>
          <TB onClick={() => addStatic("image")} icon={<ImageIcon size={13} />}>
            圖片
          </TB>
          <TB onClick={addSection} icon={<Rows3 size={13} />}>
            分段
          </TB>
          <TB onClick={() => setShowActions((v) => !v)} icon={<Zap size={13} />}>
            動作/簽核
          </TB>
          <TB onClick={() => setShowPrint((v) => !v)} icon={<Printer size={13} />}>
            列印
          </TB>
          <div className="ml-1 flex items-center gap-0.5">
            <button
              type="button"
              onClick={undo}
              disabled={!dirty}
              title="復原 (Ctrl+Z)"
              aria-label="復原"
              className="rounded-xs border border-line p-1 text-ink-4 hover:text-primary disabled:opacity-30"
            >
              <Undo2 size={13} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="取消復原 (Ctrl+Shift+Z)"
              aria-label="取消復原"
              className="rounded-xs border border-line p-1 text-ink-4 hover:text-primary disabled:opacity-30"
            >
              <Redo2 size={13} />
            </button>
          </div>
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
            <>
              {effective.sections.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {effective.sections.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 rounded-xs border border-line bg-head px-2 py-0.5 text-[10.5px] text-ink-2"
                    >
                      {s.name}
                      <button
                        type="button"
                        onClick={() =>
                          edit({
                            ...effective,
                            sections: effective.sections.filter((x) => x.id !== s.id),
                          })
                        }
                        className="text-ink-4 hover:text-er"
                        aria-label={`刪除分段 ${s.name}`}
                      >
                        <Trash2 size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <DndContext sensors={sensors} onDragEnd={onDragEnd}>
                <div
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
                        selected={selected?.type === "field" && selected.id === String(f.id)}
                        onSelect={() => setSelected({ type: "field", id: String(f.id) })}
                        onDrop={() => dropField.mutate(f.id)}
                      />
                    )
                  })}
                  {effective.statics.map((s) => (
                    <StaticCard
                      key={s.id}
                      element={s}
                      selected={selected?.type === "static" && selected.id === s.id}
                      onSelect={() => setSelected({ type: "static", id: s.id })}
                    />
                  ))}
                </div>
              </DndContext>
            </>
          )}
        </div>
      </div>

      {selField !== undefined && selected?.type === "field" ? (
        <FieldSettingsPanel
          field={selField}
          layout={effective.fields[selected.id] ?? { row: 0, col: 0 }}
          onChange={(patch) => patchField(selected.id, patch)}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {showActions ? (
        <ActionsDesigner formId={formId} form={form} onClose={() => setShowActions(false)} />
      ) : null}
      {showPrint ? (
        <PrintSettingsPanel
          fields={form.fields}
          layout={effective}
          onChange={(print: LayoutPrint) => edit({ ...effective, print })}
          onClose={() => setShowPrint(false)}
        />
      ) : null}
      {selStatic !== undefined && selected?.type === "static" ? (
        <StaticSettingsPanel
          element={selStatic}
          onChange={(patch) => patchStatic(selStatic.id, patch)}
          onDelete={() => removeStatic(selStatic.id)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  )
}

function TB({
  onClick,
  icon,
  children,
}: {
  readonly onClick: () => void
  readonly icon: ReactNode
  readonly children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-[11px] text-ink-3 hover:border-primary hover:text-primary"
    >
      {icon}
      {children}
    </button>
  )
}

function FieldCard({
  field,
  layout,
  selected,
  onSelect,
  onDrop,
}: {
  readonly field: FieldDto
  readonly layout: FieldLayout
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onDrop: () => void
}): ReactNode {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `f:${field.id}` })
  const span = layout.colSpan ?? DEFAULT_SPAN
  const meta = fieldTypeMeta(field.type)
  return (
    // biome-ignore lint/a11y/useSemanticElements: 卡片內含 grip/刪除子 button,根不可為 button(巢狀);用 role
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect()
      }}
      style={{
        gridColumn: `${layout.col + 1} / span ${span}`,
        gridRow: layout.row + 1,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : undefined,
        opacity: layout.hidden ? 0.55 : 1,
      }}
      className={`group flex cursor-pointer overflow-hidden rounded-sm border bg-card text-left ${
        selected
          ? "border-primary ring-1 ring-primary"
          : isDragging
            ? "border-primary shadow-lg"
            : "border-line"
      }`}
    >
      <button
        type="button"
        {...listeners}
        className="flex w-6 shrink-0 cursor-grab items-center justify-center border-r border-line-2 bg-head text-ink-4 hover:text-primary active:cursor-grabbing"
        aria-label={`拖曳 ${field.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={13} />
      </button>
      <span className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-1">
        <span className="flex items-center gap-1 truncate text-[11.5px] font-medium text-ink">
          {field.required ? <span className="text-er">*</span> : null}
          <span className="truncate">{field.name}</span>
          {layout.hidden ? <span className="text-[9px] text-ink-4">（隱藏）</span> : null}
        </span>
        <span className="truncate font-mono text-[9.5px] text-ink-4">
          {meta.label}
          {layout.placeholder ? ` · ${layout.placeholder}` : ""}
          {layout.defaultValue ? " · 預設" : ""}
        </span>
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDrop()
        }}
        className="flex w-6 shrink-0 items-center justify-center text-ink-4 opacity-0 hover:text-er group-hover:opacity-100"
        aria-label={`下架 ${field.name}`}
        title="下架欄位（即時,不可復原）"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function StaticCard({
  element,
  selected,
  onSelect,
}: {
  readonly element: StaticElement
  readonly selected: boolean
  readonly onSelect: () => void
}): ReactNode {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `s:${element.id}` })
  const span = element.colSpan ?? 4
  return (
    // biome-ignore lint/a11y/useSemanticElements: 卡片內含 grip 子 button,根不可為 button(巢狀);用 role
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect()
      }}
      style={{
        gridColumn: `${element.col + 1} / span ${span}`,
        gridRow: element.row + 1,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 20 : undefined,
      }}
      className={`group flex cursor-pointer overflow-hidden rounded-sm border border-dashed bg-surface text-left ${
        selected ? "border-primary ring-1 ring-primary" : "border-line"
      }`}
    >
      <button
        type="button"
        {...listeners}
        className="flex w-6 shrink-0 cursor-grab items-center justify-center border-r border-line-2 text-ink-4 hover:text-primary"
        aria-label={`拖曳元素 ${element.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={13} />
      </button>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1 text-[11px] text-ink-2">
        {element.kind === "text" ? (
          <>
            <Type size={12} className="shrink-0 text-ink-4" />
            <span className="truncate">{element.text || "文字"}</span>
          </>
        ) : (
          <>
            <ImageIcon size={12} className="shrink-0 text-ink-4" />
            <span className="truncate text-ink-4">{element.imageUrl || "圖片(未設)"}</span>
          </>
        )}
        {element.designOnly ? (
          <span className="ml-auto text-[9px] text-ink-4">設計限定</span>
        ) : null}
      </span>
    </div>
  )
}
