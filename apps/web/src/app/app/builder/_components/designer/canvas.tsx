"use client"

import { describeEngineError } from "@/lib/engine/client"
import { fieldTypeMeta } from "@/lib/engine/field-types"
import {
  formKeys,
  useDropField,
  useInvalidate,
  useLayout,
  usePutLayout,
  useRecords,
} from "@/lib/engine/hooks"
import type {
  FieldDto,
  FieldLayout,
  FormDto,
  Layout,
  LayoutPrint,
  StaticElement,
} from "@/lib/engine/schemas"
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type KeyboardCoordinateGetter,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import {
  GripVertical,
  Image as ImageIcon,
  Palette,
  Printer,
  Redo2,
  Rows3,
  Trash2,
  Type,
  Undo2,
  Zap,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActionsDesigner } from "@/app/app/builder/_components/designer/actions"
import { ConditionalFormatPanel } from "@/app/app/builder/_components/designer/conditional-format"
import {
  FieldSettingsPanel,
  StaticSettingsPanel,
} from "@/app/app/builder/_components/designer/field-settings"
import { PrintSettingsPanel } from "@/app/app/builder/_components/output/print-settings"

/* R1·UP-3 M2+M3 2D 格線畫布(OQ-FD2-7=A)。layout metadata → CSS grid;dnd-kit 拖曳重定位;
   欄位設定 / 靜態元素(文字·圖片)/ 分段 皆 layout 草稿;「儲存版面」PUT(純 metadata,零 DDL)。 */

const COL_W = 52
const ROW_H = 60
const DEFAULT_SPAN = 6
const EMPTY_LAYOUT: Layout = { grid: { cols: 12 }, fields: {}, statics: [], sections: [] }

/* 方向鍵一次移動一格(而非 dnd-kit 預設的固定像素)—— 格線上「一格」才是使用者的心智單位。 */
/* 🔴 重疊偵測(#109)。原本 onDragEnd 只 clamp col 邊界,兩個欄位可以疊在一起 ——
   疊上去之後版面看起來就是壞的,而且**存下去也不會有人擋**。

   react-grid-layout 要求 preventCollision / compactType / allowOverlap 三擇一;
   此處採 **preventCollision**:擋住會疊到的移動,而不是把別人推開。
   推擠在 2D 自由排版下很難預期(推一個會連鎖推一排),對「複刻既有紙本單據」
   這個使用情境反而更糟 —— 使用者要的是「放在我指定的位置」。

   ⚠️ 拖曳與鍵盤兩條路徑都經過 patchField/patchStatic,故防線放在這裡而非 onDragEnd。 */
interface Box {
  readonly row: number
  readonly col: number
  readonly colSpan: number
  readonly rowSpan: number
}

function overlaps(a: Box, b: Box): boolean {
  const colHit = a.col < b.col + b.colSpan && b.col < a.col + a.colSpan
  const rowHit = a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan
  return colHit && rowHit
}

function boxesOf(layout: Layout, exclude: { kind: "field" | "static"; id: string }): Box[] {
  const out: Box[] = []
  for (const [id, f] of Object.entries(layout.fields)) {
    if (exclude.kind === "field" && id === exclude.id) continue
    out.push({ row: f.row, col: f.col, colSpan: f.colSpan ?? DEFAULT_SPAN, rowSpan: 1 })
  }
  for (const s of layout.statics) {
    if (exclude.kind === "static" && s.id === exclude.id) continue
    out.push({ row: s.row, col: s.col, colSpan: s.colSpan ?? 4, rowSpan: 1 })
  }
  return out
}

const gridCoordinateGetter: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
  const step = { x: COL_W, y: ROW_H }
  switch (event.code) {
    case "ArrowRight":
      return { ...currentCoordinates, x: currentCoordinates.x + step.x }
    case "ArrowLeft":
      return { ...currentCoordinates, x: currentCoordinates.x - step.x }
    case "ArrowDown":
      return { ...currentCoordinates, y: currentCoordinates.y + step.y }
    case "ArrowUp":
      return { ...currentCoordinates, y: currentCoordinates.y - step.y }
    default:
      return undefined
  }
}

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
  const invalidate = useInvalidate()
  const dropField = useDropField(formId)
  // 設計草稿 = 時間軸(hist[idx]);idx<0 = 乾淨(= 已存 baseline)。Ctrl+Z 沿時間軸移動(OQ-FD2-2)
  const [hist, setHist] = useState<Layout[]>([])
  const [idx, setIdx] = useState(-1)
  const [selected, setSelected] = useState<Selected>(null)
  const [msg, setMsg] = useState<string | null>(null)
  /* 🔴 三個輔助面板**互斥**,不能同時開。

     原本是三個獨立布林,加上欄位設定面板,右側最多可疊出四欄。實測(1440px 寬,
     只開其中三個):工具列由 862px 被壓到 **286px**,「條件式格式」鈕變成 47×100px
     ——**五個中文字直排**,同一列的按鈕高度變成 26 / 46 / 82 / 100 四種。
     設計器的主體(畫布)反而成為最窄的一欄。

     互斥之後右側恆為 0 或 1 欄。這不是縮減功能:動作 / 條件式格式 / 列印
     本來就是各自獨立的設定,沒有並排比對的需求。 */
  const [aux, setAux] = useState<"actions" | "print" | "formats" | null>(null)
  const toggleAux = (which: "actions" | "print" | "formats"): void => {
    setAux((prev) => (prev === which ? null : which))
    setSelected(null) // 欄位設定同樣佔右欄,不與輔助面板並存
  }
  /* 即時預覽只需一筆:取第一頁第一筆(無記錄時面板顯示提示) */
  const { data: sampleData } = useRecords(formId)
  const sampleRecord = sampleData?.records[0]
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    /* 🔴 WCAG 2.1.1 Keyboard(Level A):功能必須可由鍵盤操作。
       原本只有 PointerSensor —— 沒有滑鼠就完全不能排版面,這是 A 級失敗不是體驗問題。
       空白/Enter 拿起 → 方向鍵一次移一格 → 再按空白放下(dnd-kit 內建語意)。
       coordinateGetter 依本畫布的格線尺寸走,而非預設的固定像素。 */
    useSensor(KeyboardSensor, { coordinateGetter: gridCoordinateGetter }),
  )

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
    const next = { ...cur, ...patch }
    const box: Box = {
      row: next.row,
      col: next.col,
      colSpan: next.colSpan ?? DEFAULT_SPAN,
      rowSpan: 1,
    }
    if (boxesOf(effective, { kind: "field", id }).some((b) => overlaps(box, b))) {
      setMsg("那個位置已被其他欄位佔用")
      return
    }
    edit({ ...effective, fields: { ...effective.fields, [id]: next } })
  }
  const patchStatic = (id: string, patch: Partial<StaticElement>): void => {
    const cur = effective.statics.find((s) => s.id === id)
    if (cur === undefined) return
    const next = { ...cur, ...patch }
    const box: Box = {
      row: next.row,
      col: next.col,
      colSpan: next.colSpan ?? 4,
      rowSpan: 1,
    }
    if (boxesOf(effective, { kind: "static", id }).some((b) => overlaps(box, b))) {
      setMsg("那個位置已被其他元素佔用")
      return
    }
    edit({
      ...effective,
      statics: effective.statics.map((s) => (s.id === id ? next : s)),
    })
  }
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
    /* 🔴 帶上載入時的版本(#109):整表覆寫下,不帶就是「後寫者蓋掉整張版面」 */
    putLayout.mutate(
      { ...effective, expectedVersion: layoutResp?.version },
      {
        onSuccess: () => {
          setHist([])
          setIdx(-1)
          setMsg("版面已儲存")
        },
        onError: (e) => setMsg(describeEngineError(e)),
      },
    )
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
        {/* 🔴 #140|工具列分兩段:左側工具群窄寬度時**自己橫捲**,右側主要動作固定不捲。

            原本是單一 flex row + 儲存鈕 `ml-auto`。工具列沒有 `min-w-0` 也沒有 overflow,
            視窗窄時整列**溢出畫布欄、壓到右側欄位設定面板底下** —— 儲存鈕實測 l=1029
            而面板 l=1024,`elementFromPoint` 取到的是面板,按鈕點不到(designer e2e 逾時)。

            不把整列設成可捲:那會讓「儲存版面」也跟著捲走,主要動作不該需要先捲動才按得到。 */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-card px-4 text-[12px]">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <span className="shrink-0 font-semibold text-ink-2">版面設計</span>
            <TB onClick={() => addStatic("text")} icon={<Type size={13} />}>
              文字
            </TB>
            <TB onClick={() => addStatic("image")} icon={<ImageIcon size={13} />}>
              圖片
            </TB>
            <TB onClick={addSection} icon={<Rows3 size={13} />}>
              分段
            </TB>
            <TB onClick={() => toggleAux("actions")} icon={<Zap size={13} />}>
              動作/簽核
            </TB>
            <TB onClick={() => toggleAux("print")} icon={<Printer size={13} />}>
              列印
            </TB>
            <TB onClick={() => toggleAux("formats")} icon={<Palette size={13} />}>
              條件式格式
            </TB>
            <div className="ml-1 flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={undo}
                disabled={!dirty}
                title="復原 (Ctrl+Z)"
                aria-label="復原"
                className="rounded-xs p-1 text-ink-disabled hover:text-primary disabled:opacity-30 hover:bg-hover"
              >
                <Undo2 size={13} />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                title="取消復原 (Ctrl+Shift+Z)"
                aria-label="取消復原"
                className="rounded-xs p-1 text-ink-disabled hover:text-primary disabled:opacity-30 hover:bg-hover"
              >
                <Redo2 size={13} />
              </button>
            </div>
          </div>
          {dirty ? <span className="shrink-0 text-[12px] text-warn">● 未儲存</span> : null}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || putLayout.isPending}
            className="shrink-0 rounded-xs bg-primary px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-primary-d disabled:opacity-40"
          >
            {putLayout.isPending ? "儲存中…" : "儲存版面"}
          </button>
        </div>
        {msg !== null ? (
          <div className="shrink-0 border-b border-line bg-label px-4 py-1.5 text-[12px] text-ink-2">
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
                      className="inline-flex items-center gap-1 rounded-xs border border-line bg-head px-2 py-0.5 text-[12px] text-ink-2"
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
                        className="text-ink-3 hover:text-er"
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
                        onSelect={() => {
                          setAux(null)
                          setSelected({ type: "field", id: String(f.id) })
                        }}
                        onDrop={() => dropField.mutate(f.id)}
                      />
                    )
                  })}
                  {effective.statics.map((s) => (
                    <StaticCard
                      key={s.id}
                      element={s}
                      selected={selected?.type === "static" && selected.id === s.id}
                      onSelect={() => {
                        setAux(null)
                        setSelected({ type: "static", id: s.id })
                      }}
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
          formId={formId}
          cols={cols}
          layout={effective.fields[selected.id] ?? { row: 0, col: 0 }}
          onChange={(patch) => patchField(selected.id, patch)}
          onClose={() => setSelected(null)}
          onOptionsSaved={() => invalidate([formKeys.detail(formId)])}
        />
      ) : null}
      {aux === "actions" ? (
        <ActionsDesigner formId={formId} form={form} onClose={() => setAux(null)} />
      ) : null}
      {aux === "formats" ? (
        <ConditionalFormatPanel
          fields={form.fields}
          formats={effective.conditionalFormats}
          sample={sampleRecord}
          onChange={(conditionalFormats) => edit({ ...effective, conditionalFormats })}
          onClose={() => setAux(null)}
        />
      ) : null}
      {aux === "print" ? (
        <PrintSettingsPanel
          fields={form.fields}
          layout={effective}
          onChange={(print: LayoutPrint) => edit({ ...effective, print })}
          onClose={() => setAux(null)}
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
      /* 🔴 `shrink-0` + `whitespace-nowrap` 缺一不可。
         少了它們,外層的 `overflow-x-auto`(#140 加的)**永遠不會觸發** ——
         flex 會先壓縮子元素,中文沒有詞邊界所以逐字斷行,於是內容永遠塞得下、
         永遠不溢出、也就永遠不捲。結果是按鈕變成直排而不是出現捲軸。 */
      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xs px-2 py-1 text-[12px] text-ink-3 hover:text-primary hover:bg-hover"
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `f:${field.id}`,
  })
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
        {...attributes}
        {...listeners}
        className="flex w-6 shrink-0 cursor-grab items-center justify-center border-r border-line-2 bg-head text-ink-2 hover:text-primary active:cursor-grabbing"
        aria-label={`拖曳 ${field.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={13} />
      </button>
      <span className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-1">
        <span className="flex items-center gap-1 truncate text-[12px] font-medium text-ink">
          {field.required ? <span className="text-er">*</span> : null}
          <span className="truncate">{field.name}</span>
          {layout.hidden ? <span className="text-[12px] text-ink-3">（隱藏）</span> : null}
        </span>
        <span className="truncate font-mono text-[12px] text-ink-3">
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
        className="flex w-6 shrink-0 items-center justify-center text-ink-3 opacity-0 hover:text-er group-hover:opacity-100"
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `s:${element.id}`,
  })
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
        {...attributes}
        {...listeners}
        className="flex w-6 shrink-0 cursor-grab items-center justify-center border-r border-line-2 text-ink-3 hover:text-primary"
        aria-label={`拖曳元素 ${element.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={13} />
      </button>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1 text-[12px] text-ink-2">
        {element.kind === "text" ? (
          <>
            <Type size={12} className="shrink-0 text-ink-3" />
            <span className="truncate">{element.text || "文字"}</span>
          </>
        ) : (
          <>
            <ImageIcon size={12} className="shrink-0 text-ink-3" />
            <span className="truncate text-ink-3">{element.imageUrl || "圖片(未設)"}</span>
          </>
        )}
        {element.designOnly ? (
          <span className="ml-auto text-[12px] text-ink-3">設計限定</span>
        ) : null}
      </span>
    </div>
  )
}
