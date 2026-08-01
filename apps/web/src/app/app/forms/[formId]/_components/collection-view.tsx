"use client"

import { formatFieldValue, toSubmitValue } from "@/components/form/value"
import { gridEditData, gridKind, isGridEditable } from "@/components/form/grid-cells"
import { useMemberNames } from "@/lib/engine/authz"
import { GroupedView } from "./grouped-view"
import { describeEngineError } from "@/lib/engine/client"
import { evaluateFormats } from "@/lib/engine/conditional-format"
import { operatorNeedsValue } from "@/lib/engine/field-filters"
import { gridThemeOverride } from "@/lib/engine/grid-tone"
import {
  type RecordQuery,
  useDeleteRecord,
  useGroupStats,
  useInfiniteRecordsQuery,
  useLayout,
  useUpdateRecord,
} from "@/lib/engine/hooks"
import type { FieldDto, FormDto, RecordRow, ViewConfig } from "@/lib/engine/schemas"
import {
  CompactSelection,
  type EditableGridCell,
  type GridCell,
  GridCellKind,
  type GridColumn,
  type GridSelection,
  type Item,
} from "@glideapps/glide-data-grid"
import { GridSheet } from "@weyver/ui/grid-sheet"
import type { ChipTone } from "@weyver/ui/status-chip"
import { type ReactNode, useMemo, useState } from "react"

const EMPTY_SELECTION: GridSelection = {
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
}

/* R1·UP-2 集合(browse)視圖:Glide 網格套 view 選欄/篩選/排序 + 快速搜尋;前導「開啟」欄下鑽記錄頁;
   inline 編輯依欄位寫入權限(後端 assertWritable 強制;編輯後不即時 re-sort,留位至 refetch)。 */
export function CollectionView({
  formId,
  form,
  view,
  quickSearch,
  onRowOpen,
}: {
  readonly formId: number
  readonly form: FormDto
  readonly view: ViewConfig | null
  readonly quickSearch: string
  readonly onRowOpen: (recordId: number) => void
}): ReactNode {
  const updateRecord = useUpdateRecord(formId)
  const deleteRecord = useDeleteRecord(formId)
  const [error, setError] = useState<string | null>(null)
  const memberNames = useMemberNames(form.fields)
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION)
  /* 折疊狀態 —— 傳到後端從查詢排除,而非前端隱藏(否則折疊後仍吃 page size)。 */
  const [collapsed, setCollapsed] = useState<readonly (readonly string[])[]>([])

  const query = useMemo<RecordQuery>(
    () => ({
      // 跳過未填值的條件(避免 op 需值但空 → 後端 422;亦即「輸入前不套用」)
      filters: (view?.filter.conditions ?? []).filter(
        (c) =>
          !operatorNeedsValue(c.op) ||
          (c.value !== "" && c.value !== null && c.value !== undefined),
      ),
      combinator: view?.filter.combinator ?? "and",
      sort: view?.sorts ?? [],
      q: quickSearch.trim() || view?.search || undefined,
      groupBy: view?.groupBy ?? [],
      collapsed,
    }),
    [view, quickSearch, collapsed],
  )
  const recordsQuery = useInfiniteRecordsQuery(formId, query)
  const grouped = (view?.groupBy ?? []).length > 0
  const stats = useGroupStats(formId, query, view?.aggregates ?? [])
  const records: RecordRow[] = useMemo(
    () => recordsQuery.data?.pages.flatMap((p) => p.records) ?? [],
    [recordsQuery.data],
  )

  // view 選欄(依名解析成現存欄、保序;丟棄已不存在的名);空 = 全欄
  const displayFields: FieldDto[] = useMemo(() => {
    if (view === null || view.fields.length === 0) return form.fields
    const byName = new Map(form.fields.map((f) => [f.name, f]))
    return view.fields.map((n) => byName.get(n)).filter((f): f is FieldDto => f !== undefined)
  }, [view, form.fields])

  const selectedIds = useMemo(
    () =>
      selection.rows
        .toArray()
        .map((i) => records[i]?.id)
        .filter((id): id is number => id !== undefined),
    [selection, records],
  )

  /* 🔴 `xlsx` **動態載入**。它是整個路由裡最大的第三方相依,但只有按下「匯出」
     才用得到 —— 靜態匯入等於讓每個只是來看資料的人先下載一份試算表函式庫。 */
  const onExport = async (): Promise<void> => {
    const { utils, writeFile } = await import("xlsx")
    const rows = records.map((r) => {
      const o: Record<string, unknown> = {}
      for (const f of displayFields) {
        const disp = formatFieldValue(f, r.values[f.name], memberNames)
        o[f.name] = disp === "—" ? "" : disp
      }
      return o
    })
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, (form.name || "Sheet1").slice(0, 31))
    writeFile(wb, `${form.name || "export"}.xlsx`)
  }

  const onBatchDelete = async (): Promise<void> => {
    if (selectedIds.length === 0 || !window.confirm(`刪除選取的 ${selectedIds.length} 筆?`)) return
    setError(null)
    for (const id of selectedIds) {
      try {
        await deleteRecord.mutateAsync(id)
      } catch (e) {
        setError(describeEngineError(e))
      }
    }
    setSelection(EMPTY_SELECTION)
  }

  const OPEN_COL = 0
  const columns: GridColumn[] = [
    { title: "", id: "__open__", width: 52 },
    ...displayFields.map((f) => ({
      title: f.name,
      id: String(f.id),
      width: f.type === "longText" ? 240 : 140,
    })),
  ]

  /* R1·UP-3b 條件式格式(列表頁那一組)。每列求值一次並快取 —— 避免每個 cell 重算
     (每列 ≤20 規則 × ≤20 條件;FMEA G6)。 */
  const { data: layoutResp } = useLayout(formId)
  const listRules = layoutResp?.layout?.conditionalFormats?.list ?? []
  const fieldNames = form.fields.map((f) => f.name)
  const toneCache = new Map<number, Map<string, ChipTone>>()
  const tonesFor = (row: number): Map<string, ChipTone> => {
    const cached = toneCache.get(row)
    if (cached !== undefined) return cached
    const record = records[row]
    const tones =
      record === undefined || listRules.length === 0
        ? new Map<string, ChipTone>()
        : evaluateFormats(listRules, record.values, fieldNames)
    toneCache.set(row, tones)
    return tones
  }

  const getCell = ([col, row]: Item): GridCell => {
    if (col === OPEN_COL) {
      return {
        kind: GridCellKind.Text,
        data: "",
        displayData: "檢視 ↗",
        allowOverlay: false,
      }
    }
    const field = displayFields[col - 1]
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
    const themeOverride = gridThemeOverride(tonesFor(row).get(field.name))
    if (kind === "number") {
      const n = gridEditData(field, value)
      return {
        kind: GridCellKind.Number,
        data: typeof n === "number" && Number.isFinite(n) ? n : undefined,
        displayData: display,
        allowOverlay: editable,
        readonly: !editable,
        ...(themeOverride === undefined ? {} : { themeOverride }),
      }
    }
    return {
      kind: GridCellKind.Text,
      data: String(gridEditData(field, value)),
      displayData: display,
      allowOverlay: editable,
      readonly: !editable,
      ...(themeOverride === undefined ? {} : { themeOverride }),
    }
  }

  const onCellClicked = ([col, row]: Item): void => {
    if (col !== OPEN_COL) return
    const record = records[row]
    if (record !== undefined) onRowOpen(record.id)
  }

  const onCellEdited = ([col, row]: Item, newValue: EditableGridCell): void => {
    if (col === OPEN_COL) return
    const field = displayFields[col - 1]
    const record = records[row]
    if (field === undefined || record === undefined || !isGridEditable(field)) return

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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {error !== null ? (
        <div className="border-b border-er-line bg-er-t px-4 py-1.5 text-[14px] text-er">
          {error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 p-3">
        {recordsQuery.isPending ? (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-3">
            載入記錄…
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-ink-3">
            無相符記錄{query.q || query.filters.length > 0 ? "(篩選/搜尋無結果)" : ""}。
          </div>
        ) : grouped ? (
          <GroupedView
            records={records}
            fields={displayFields}
            groups={view?.groupBy ?? []}
            stats={stats.data}
            collapsed={collapsed}
            onToggle={(key) =>
              setCollapsed((prev) =>
                prev.some((c) => c.join(" ") === key.join(" "))
                  ? prev.filter((c) => c.join(" ") !== key.join(" "))
                  : [...prev, [...key]],
              )
            }
            onOpen={onRowOpen}
            memberNames={memberNames}
            query={query}
          />
        ) : (
          <GridSheet
            columns={columns}
            rowCount={records.length}
            getCell={getCell}
            onCellEdited={onCellEdited}
            onCellClicked={onCellClicked}
            rowMarkers="both"
            gridSelection={selection}
            onGridSelectionChange={setSelection}
            height="100%"
            className="border border-line"
          />
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-card px-4 text-[12px] text-ink-3">
        <span className="font-mono">
          {records.length} 筆{selectedIds.length > 0 ? ` · 已選 ${selectedIds.length}` : ""}
        </span>
        {selectedIds.length > 0 ? (
          <button
            type="button"
            onClick={() => void onBatchDelete()}
            className="rounded-xs border border-line px-2 py-0.5 text-er hover:border-er hover:bg-er-t"
          >
            批次刪除
          </button>
        ) : null}
        <button
          type="button"
          onClick={onExport}
          disabled={records.length === 0}
          className="rounded-xs border border-line px-2 py-0.5 hover:bg-head disabled:opacity-50"
        >
          匯出 Excel
        </button>
        {recordsQuery.hasNextPage ? (
          <>
            <button
              type="button"
              onClick={() => void recordsQuery.fetchNextPage()}
              disabled={recordsQuery.isFetchingNextPage}
              className="rounded-xs border border-line px-2 py-0.5 hover:bg-head disabled:opacity-50"
            >
              {recordsQuery.isFetchingNextPage ? "載入中…" : "載更多"}
            </button>
            <span className="text-ink-3">(匯出僅含已載入 {records.length} 筆)</span>
          </>
        ) : null}
      </div>
    </div>
  )
}
