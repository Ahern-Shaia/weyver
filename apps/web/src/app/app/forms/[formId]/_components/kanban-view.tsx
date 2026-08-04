"use client"

import { formatFieldValue } from "@/components/form/value"
import { choicesOf } from "@/components/form/value"
import { describeEngineError } from "@/lib/engine/client"
import { useUpdateRecord } from "@/lib/engine/hooks"
import { useDisplayCtx } from "@/lib/engine/use-settings"
import type { FieldDto, FormDto, RecordRow } from "@/lib/engine/schemas"
import {
  type ClientRect,
  DndContext,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { type ReactNode, useState } from "react"

/* 🔴 F-1 M3 Kanban。stack 就是**單欄 group-by 的一階特例**,故資料層完整共用 M1。

   **拖曳不開後門**|走既有 `PATCH /records/:id`,天然吃到四層防護:
   expectedVersion 樂觀鎖 · 欄位級 assertWritable · RLS 記錄範圍 · 簽核鎖。
   業界普遍是 last-write-wins 且無記錄鎖(查不到任何表單資料庫在拖曳 API 上做顯式樂觀鎖),
   本專案因此天然優於業界 —— 代價只是「要把失敗訊息說清楚」。

   **失敗必須具名**|Jira 是有紀錄的反面教材:卡片彈回卻常無明確錯誤訊息,
   Atlassian KB 還得把「排序失敗」與「狀態轉換失敗」列為兩種不同原因。
   本元件對三類失敗給不同訊息,絕不靜默彈回。 */

/* 分欄欄位型別(OQ-VG-6=A):單選 + 使用者。
   單選是業界共同底線(Airtable/Baserow/NocoDB 皆僅此);member 額外開放的理由是
   E-1「指派即授權」已上,「依負責人看板」是直接的真實用途。 */
export function canStackBy(field: FieldDto): boolean {
  return field.type === "singleSelect" || field.type === "member"
}

/* computed 欄不可拖(比照 Teable)—— 其值由引擎算出,拖了也寫不回去 */
const COMPUTED = new Set([
  "formula",
  "rollup",
  "lookup",
  "autoNumber",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
])

const UNCATEGORIZED = "__uncategorized__"

/* 鍵盤拖曳的落點計算:看板是**橫向的欄**,一次跳一整欄。
   不能用 dnd-kit 的預設 getter —— 它一次移 25px,跨一欄要按十幾下,
   等於「技術上可用、實際上不可用」,而 WCAG 2.1.1 要的是後者。
   ↑/↓ 不接管(欄內排序不由本元件決定,排序在檢視設定)。 */
const stackCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  const dir = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0
  if (dir === 0) return undefined
  const dragged = context.collisionRect
  if (dragged === null) return undefined

  const rects: ClientRect[] = context.droppableContainers
    .getEnabled()
    .map((c) => context.droppableRects.get(c.id))
    .filter((r): r is ClientRect => r !== undefined)
    .sort((a, b) => a.left - b.left)
  if (rects.length === 0) return undefined

  const centerOf = (r: ClientRect): number => r.left + r.width / 2
  const draggedCenter = centerOf(dragged)
  /* 用最近的欄當基準而非「包含」—— 卡片被拖到欄與欄的間隙時 `包含` 會找不到 */
  let fromIdx = 0
  let best = Number.POSITIVE_INFINITY
  rects.forEach((r, i) => {
    const d = Math.abs(centerOf(r) - draggedCenter)
    if (d < best) {
      best = d
      fromIdx = i
    }
  })

  const toIdx = fromIdx + dir
  const target = rects[toIdx]
  if (target === undefined) return undefined // 已在最左/最右,不繞回
  return {
    x: currentCoordinates.x + (centerOf(target) - draggedCenter),
    y: currentCoordinates.y,
  }
}

function Card({
  record,
  fields,
  disabled,
  onOpen,
  memberNames,
  linkLabels,
  fmtCtx,
}: {
  readonly record: RecordRow
  readonly fields: readonly FieldDto[]
  readonly disabled: boolean
  readonly onOpen: (id: number) => void
  readonly memberNames: ReadonlyMap<number, string>
  readonly linkLabels: ReadonlyMap<string, string>
  /* 🔴 由上層傳入,**不在卡片裡自己訂閱**。在 Card 內呼叫 `useDisplayCtx()`
     會讓每張卡片各自掛一個 query 訂閱 —— 設定回來時全部重繪,
     而 dnd-kit 的鍵盤拖曳靠 `document.activeElement`:重繪把焦點吃掉,
     Space 就什麼都沒發生,**畫面看起來完全正常**。
     這不是假設 —— 我先前在這裡呼叫 hook,`group-kanban-calendar` 那條
     鍵盤測試立刻從「單跑會過」變成「單跑也不過」。 */
  readonly fmtCtx: { timeZone?: string | undefined; locale?: string | undefined }
}): ReactNode {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(record.id),
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`border border-line bg-card px-2.5 py-1.5 text-[12px] ${
        isDragging ? "opacity-40" : ""
      } ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
    >
      <button
        type="button"
        onClick={() => onOpen(record.id)}
        className="w-full truncate text-left font-medium text-ink hover:underline"
      >
        {formatFieldValue(
          fields[0] as FieldDto,
          record.values[fields[0]?.name ?? ""],
          memberNames,
          fmtCtx,
          linkLabels,
        ) || `#${String(record.id)}`}
      </button>
      {fields.slice(1, 3).map((f) => (
        <div key={f.id} className="truncate text-[12px] text-ink-3">
          {formatFieldValue(f, record.values[f.name], memberNames, fmtCtx, linkLabels)}
        </div>
      ))}
    </div>
  )
}

function Column({
  id,
  title,
  count,
  children,
}: {
  readonly id: string
  readonly title: string
  readonly count: number
  readonly children: ReactNode
}): ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      data-stack={id}
      aria-label={`看板欄 ${title}`}
      className={`flex w-60 shrink-0 flex-col gap-1.5 border p-2 ${
        isOver ? "border-primary bg-primary/5" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
        {title}
        <span className="ml-auto font-mono text-[12px] font-normal text-ink-3">{count}</span>
      </div>
      {children}
    </div>
  )
}

export function KanbanView({
  formId,
  form,
  records,
  stackField,
  memberNames,
  linkLabels,
  onOpen,
  counts,
}: {
  readonly formId: number
  readonly form: FormDto
  readonly records: readonly RecordRow[]
  readonly stackField: FieldDto
  readonly memberNames: ReadonlyMap<number, string>
  readonly linkLabels: ReadonlyMap<string, string>
  readonly onOpen: (id: number) => void
  /* 每欄總筆數來自後端 group-stats(可能多於已載入的卡片) */
  readonly counts: ReadonlyMap<string, number>
}): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const fmtCtx = useDisplayCtx()
  const updateRecord = useUpdateRecord(formId)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    /* 🔴 WCAG 2.1.1 Keyboard(Level A)。與 `designer/canvas.tsx` 完全同型的缺口:
       原本只有 PointerSensor,沒有滑鼠就完全不能移動卡片。
       空白/Enter 拿起 → ←/→ 換一欄 → 再按空白放下(dnd-kit 內建語意)。 */
    useSensor(KeyboardSensor, { coordinateGetter: stackCoordinateGetter }),
  )

  const locked = COMPUTED.has(stackField.type)

  const stacks: { id: string; title: string }[] = [
    ...(stackField.type === "singleSelect"
      ? choicesOf(stackField).map((c) => ({ id: c, title: c }))
      : [...memberNames].map(([id, name]) => ({ id: String(id), title: name }))),
    { id: UNCATEGORIZED, title: "未分類" },
  ]

  const keyOf = (r: RecordRow): string => {
    const v = r.values[stackField.name]
    return v === null || v === undefined || v === "" ? UNCATEGORIZED : String(v)
  }

  const onDragEnd = (e: DragEndEvent): void => {
    const to = e.over?.id
    if (to === undefined) return
    const record = records.find((r) => String(r.id) === String(e.active.id))
    if (record === undefined) return
    const target = String(to)
    if (keyOf(record) === target) return

    setError(null)
    const next =
      target === UNCATEGORIZED ? null : stackField.type === "member" ? Number(target) : target
    updateRecord.mutate(
      { recordId: record.id, expectedVersion: record.version, values: { [stackField.name]: next } },
      {
        /* 🔴 失敗具名(Jira 的坑)。三類訊息分開,絕不靜默彈回。
           卡片會因 query 失效而回到原位,但使用者必須知道為什麼。 */
        onError: (err) => {
          const msg = describeEngineError(err)
          setError(
            msg.includes("簽核")
              ? "此記錄簽核中,不可異動。"
              : msg.includes("版本") || msg.includes("VERSION")
                ? "已被他人改動,請重新整理後再試。"
                : msg,
          )
        },
      },
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error !== null ? (
        <div className="border-b border-er-line bg-er-t px-4 py-1.5 text-[14px] text-er">
          {error}
        </div>
      ) : null}
      {locked ? (
        <div className="border-b border-line bg-warn/5 px-4 py-1.5 text-[12px] text-ink">
          「{stackField.name}」是由系統計算的欄位,卡片不可拖曳。
        </div>
      ) : null}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3">
          {stacks.map((s) => {
            const rows = records.filter((r) => keyOf(r) === s.id)
            return (
              <Column key={s.id} id={s.id} title={s.title} count={counts.get(s.id) ?? rows.length}>
                {rows.map((r) => (
                  <Card
                    key={r.id}
                    record={r}
                    fields={form.fields}
                    disabled={locked}
                    onOpen={onOpen}
                    memberNames={memberNames}
                    linkLabels={linkLabels}
                    fmtCtx={fmtCtx}
                  />
                ))}
              </Column>
            )
          })}
        </div>
      </DndContext>
    </div>
  )
}
