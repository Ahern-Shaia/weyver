"use client"

import { useMemberNames } from "@/lib/engine/authz"
import { describeEngineError } from "@/lib/engine/client"
import { useCreateRecord, useForm, useInfiniteRecords, useUpdateRecord } from "@/lib/engine/hooks"
import type { RecordRow } from "@/lib/engine/schemas"
import {
  type EditableGridCell,
  type GridCell,
  GridCellKind,
  type GridColumn,
  type Item,
} from "@glideapps/glide-data-grid"
import { Button } from "@weyver/ui/button"
import { GridSheet } from "@weyver/ui/grid-sheet"
import { StatusChip, type StatusTone } from "@weyver/ui/status-chip"
import { useMemo, useState } from "react"
import { formatFieldValue, toSubmitValue } from "@/components/form/value"
import { gridEditData, gridKind, isGridEditable } from "@/components/form/grid-cells"

const STATE_TONE: Record<string, StatusTone> = { ready: "ok", pending: "warn", failed: "error" }

export function RecordGridPanel({ formId }: { formId: number }) {
  const formQuery = useForm(formId)
  const recordsQuery = useInfiniteRecords(formId)
  const updateRecord = useUpdateRecord(formId)
  const createRecord = useCreateRecord(formId)
  const [error, setError] = useState<string | null>(null)
  const memberNames = useMemberNames(formQuery.data?.fields ?? [])

  const records: RecordRow[] = useMemo(
    () => recordsQuery.data?.pages.flatMap((p) => p.records) ?? [],
    [recordsQuery.data],
  )

  if (formQuery.data === undefined) {
    return <div className="p-6 text-[12px] text-ink-3">載入中…</div>
  }
  const form = formQuery.data
  const fields = form.fields
  const hasRequired = fields.some((f) => f.required && f.type !== "autoNumber")

  const columns: GridColumn[] = fields.map((f) => ({
    title: f.name,
    id: String(f.id),
    width: f.type === "longText" ? 240 : 140,
  }))

  const getCell = ([col, row]: Item): GridCell => {
    const field = fields[col]
    const record = records[row]
    if (field === undefined || record === undefined) {
      return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false }
    }
    const value = record.values[field.name]
    const editable = isGridEditable(field)
    const shown = formatFieldValue(field, value, memberNames)
    const display = shown === "—" ? "" : shown
    const kind = gridKind(field.type)

    if (kind === "boolean") {
      return {
        kind: GridCellKind.Boolean,
        data: value === true,
        allowOverlay: false,
        readonly: !editable,
      }
    }
    if (kind === "number") {
      const n = gridEditData(field, value)
      return {
        kind: GridCellKind.Number,
        data: typeof n === "number" && Number.isFinite(n) ? n : undefined,
        displayData: display,
        allowOverlay: editable,
        readonly: !editable,
      }
    }
    return {
      kind: GridCellKind.Text,
      data: String(gridEditData(field, value)),
      displayData: display,
      allowOverlay: editable,
      readonly: !editable,
    }
  }

  const onCellEdited = ([col, row]: Item, newValue: EditableGridCell): void => {
    const field = fields[col]
    const record = records[row]
    if (field === undefined || record === undefined || !isGridEditable(field)) return

    // Glide 依 cell kind 給不同型別;toSubmitValue 數值分支收字串 → 依 gridKind 正規化
    let raw: unknown
    const kind = gridKind(field.type)
    if (kind === "boolean") {
      raw = newValue.kind === GridCellKind.Boolean && newValue.data === true
    } else if (kind === "number") {
      const d = newValue.kind === GridCellKind.Number ? newValue.data : undefined
      raw = d === undefined || d === null ? "" : String(d)
    } else {
      raw = newValue.kind === GridCellKind.Text ? newValue.data : ""
    }
    const converted = toSubmitValue(field, raw)

    setError(null)
    updateRecord.mutate(
      {
        recordId: record.id,
        expectedVersion: record.version,
        values: { [field.name]: converted ?? null },
      },
      { onError: (e) => setError(describeEngineError(e)) },
    )
  }

  const addRow = () => {
    setError(null)
    createRecord.mutate({}, { onError: (e) => setError(describeEngineError(e)) })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-card px-4 py-2">
        <span className="text-[13px] font-semibold">{form.name}</span>
        <StatusChip tone={STATE_TONE[form.provisionState] ?? "neutral"}>
          {form.provisionState}
        </StatusChip>
        <span className="font-mono text-[12px] text-ink-3">{records.length} 筆</span>
        <div className="ml-auto flex gap-1.5">
          {recordsQuery.hasNextPage ? (
            <Button
              onClick={() => void recordsQuery.fetchNextPage()}
              disabled={recordsQuery.isFetchingNextPage}
            >
              {recordsQuery.isFetchingNextPage ? "載入中…" : "載更多"}
            </Button>
          ) : null}
          <Button onClick={addRow} disabled={hasRequired || createRecord.isPending}>
            ＋ 新增列
          </Button>
        </div>
      </div>

      {hasRequired ? (
        <div className="border-b border-line bg-head px-4 py-1 text-[12px] text-ink-2">
          此表有必填欄 —— 新增空白列會被拒;請用「填單」新增,網格用於編輯既有資料。
        </div>
      ) : null}
      {error !== null ? (
        <div className="border-b border-er-line bg-er-t px-4 py-1.5 text-[14px] text-er">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 p-3">
        {records.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-3">
            尚無資料 —— 切「填單」新增,或 P0-2 Excel 匯入。
          </div>
        ) : (
          <GridSheet
            columns={columns}
            rowCount={records.length}
            getCell={getCell}
            onCellEdited={onCellEdited}
            height="100%"
            className="border border-line"
          />
        )}
      </div>
    </div>
  )
}
