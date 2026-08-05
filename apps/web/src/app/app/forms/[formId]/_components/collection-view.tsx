"use client"

import { gridEditData, gridKind, isGridEditable } from "@/components/form/grid-cells"
import { formatFieldValue, toSubmitValue } from "@/components/form/value"
import { useMemberNames } from "@/lib/engine/authz"
import { useDisplayCtx } from "@/lib/engine/use-settings"
import { describeEngineError } from "@/lib/engine/client"
import { evaluateFormats } from "@/lib/engine/conditional-format"
import { gridThemeOverride } from "@/lib/engine/grid-tone"
import {
  type RecordQuery,
  useDeleteRecord,
  useGroupStats,
  useInfiniteRecordsQuery,
  useLayout,
  useLinkLabels,
  useUpdateRecord,
} from "@/lib/engine/hooks"
import type { FieldDto, FormDto, RecordRow, ViewConfig } from "@/lib/engine/schemas"
import { buildRecordQuery } from "@/lib/engine/view-query"
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
import { GroupedView } from "./grouped-view"
import { PasteBanner } from "./paste-banner"
import { useGridPaste } from "./use-grid-paste"

const EMPTY_SELECTION: GridSelection = {
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
}

/* 瀏覽器端匯出的列數上限。超過就該走設定中心的租戶級匯出(非同步產檔)。
   一萬列的 xlsx 在瀏覽器裡組已經接近痛的邊緣,而再上去只會變成分頁當掉。 */
const EXPORT_MAX_ROWS = 10_000

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
  const fmtCtx = useDisplayCtx()
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION)
  /* 折疊狀態 —— 傳到後端從查詢排除,而非前端隱藏(否則折疊後仍吃 page size)。 */
  const [collapsed, setCollapsed] = useState<readonly (readonly string[])[]>([])

  /* 🔴 與樞紐 / 圖表共用同一份推導(`buildRecordQuery`)——
     這段原本只寫在這裡,而 workspace 傳給樞紐的是寫死的空 filter。 */
  const query = useMemo<RecordQuery>(
    () => buildRecordQuery({ view, quickSearch, collapsed }),
    [view, quickSearch, collapsed],
  )
  const recordsQuery = useInfiniteRecordsQuery(formId, query)
  const [exporting, setExporting] = useState(false)
  /* 🔴 凍結欄(`grid-paste.md` §8)。**讀出來再 clamp 一次** ——
     欄位可能在設定之後被刪掉,存的時候合法不代表現在合法(FMEA G3)。
     另外不讓凍結欄佔滿畫面:至多一半的欄(FMEA G4)。 */
  const freezeColumns = Math.max(0, Math.min(view?.freezeColumns ?? 0, 5))

  const grouped = (view?.groupBy ?? []).length > 0
  const stats = useGroupStats(formId, query, view?.aggregates ?? [])
  const records: RecordRow[] = useMemo(
    () => recordsQuery.data?.pages.flatMap((p) => p.records) ?? [],
    [recordsQuery.data],
  )

  /* 🔴 audit-D §2.2|連結欄本頁用到的 id → 標題。不解析的話畫面上是裸數字。 */
  const linkLabels = useLinkLabels(formId, form.fields, records)
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
    /* 🔴 **匯出前先把剩下的頁抓完**。

       原本只匯出「已載入的頁」—— 使用者捲了兩頁就按匯出,拿到的是 100 筆,
       而畫面上有 5000 筆,**沒有任何提示**。那是這個 repo 反覆踩的
       「靜默少做」:檔案打得開、格式也對,只是資料少了,而他不會發現。

       上限存在是因為這是**瀏覽器端**的匯出:再多就該走設定中心的
       租戶級匯出(R1·I-1,非同步產檔)。超過上限**明說**,並指得出去哪裡拿完整的。 */
    /* 🔴 **一律用 `fetchNextPage()` 的回傳值,不要讀元件上的 `records` / `hasNextPage`。**

       它們是 render 當下捕捉的閉包:非同步迴圈裡它們**永遠不會變**,
       於是迴圈只跑一次就以為抓完了,匯出的仍是第一頁。
       e2e 抓到(建 250 筆、匯出只有 200),而型別檢查完全不會抱怨。 */
    setExporting(true)
    let pages = recordsQuery.data
    let hasNext = recordsQuery.hasNextPage
    const countOf = (d: typeof pages): number =>
      d?.pages.reduce((n, p) => n + p.records.length, 0) ?? 0
    try {
      let guard = 0
      /* 迴圈上限:`hasNextPage` 若因為任何原因恆真,這裡不會轉到天亮 */
      while (hasNext && countOf(pages) < EXPORT_MAX_ROWS && guard < 200) {
        guard += 1
        const next = await recordsQuery.fetchNextPage()
        pages = next.data
        hasNext = next.hasNextPage
      }
    } finally {
      setExporting(false)
    }
    const all = pages?.pages.flatMap((p) => p.records) ?? []
    if (hasNext) {
      window.alert(
        `資料超過瀏覽器匯出上限(${String(EXPORT_MAX_ROWS)} 筆),本次只會匯出前 ${String(all.length)} 筆。\n` +
          "要完整資料請用「設定 → 資料匯出」,那一條是非同步產檔、不受此限。",
      )
    }

    const { utils, writeFile } = await import("xlsx")
    const rows = all.map((r) => {
      const o: Record<string, unknown> = {}
      for (const f of displayFields) {
        const disp = formatFieldValue(f, r.values[f.name], memberNames, fmtCtx, linkLabels)
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
  /* 🔴 R1·GP M3/M4|貼上。`filtered` 決定能不能加列(OQ-GP-3 硬約束 ii)——
     套著篩選時使用者看到的列不是全部,加列會加在他看不到的地方(Teable 踩過)。 */
  const paste = useGridPaste({
    formId,
    fields: displayFields,
    records,
    /* ⚠️ 用真值判斷不是 `!== ""` —— `query.q` 未設時是 null 而非空字串,
       寫成 `!== ""` 會**恆為 true**,把「沒有篩選」也判成有篩選,
       於是永遠不給加列。同檔下方的空狀態訊息用的也是真值判斷。 */
    filtered: Boolean(query.q) || query.filters.length > 0,
    colOffset: 1,
  })
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
    const shown = formatFieldValue(field, value, memberNames, fmtCtx, linkLabels)
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
    /* 不合法的格標紅(OQ-GP-5)。**優先於條件式格式的顏色** ——
       「這格貼不進去」比「這格符合某條規則」更需要被看到。 */
    const themeOverride = paste.isCellInvalid(row, col - 1)
      ? gridThemeOverride("error")
      : gridThemeOverride(tonesFor(row).get(field.name))
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
      <PasteBanner paste={paste} />
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
            fmtCtx={fmtCtx}
            linkLabels={linkLabels}
            query={query}
          />
        ) : (
          <GridSheet
            columns={columns}
            rowCount={records.length}
            getCell={getCell}
            onPaste={paste.onPaste}
            onFillPattern={paste.onFillPattern}
            {...(freezeColumns > 0 ? { freezeColumns } : {})}
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
        {/* 🔴 尚有未載入的頁時,**不得**只寫「N 筆」。
            `records` 是已載入頁的合計,不是總數 —— 使用者看到「50 筆」會直接理解成
            這張表就 50 筆記錄,而那是把分頁大小當成事實陳述。
            docs/14 把筆數列為信任訊號;**錯的信任訊號比沒有更糟**。
            (docs/28 §5-bis V5:Metabase 同一處寫 `Showing first 2,000 rows`,
             走的是誠實截斷而非另跑一次 COUNT —— 大表上 COUNT 的代價不值得。) */}
        <span className="font-mono">
          {recordsQuery.hasNextPage ? `已載入 ${records.length} 筆` : `${records.length} 筆`}
          {selectedIds.length > 0 ? ` · 已選 ${selectedIds.length}` : ""}
        </span>
        {selectedIds.length > 0 ? (
          <button
            type="button"
            onClick={() => void onBatchDelete()}
            className="rounded-xs px-2 py-0.5 text-er hover:border-er hover:bg-er-t"
          >
            批次刪除
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={records.length === 0 || exporting}
          className="rounded-xs px-2 py-0.5 hover:bg-hover disabled:opacity-50"
        >
          {exporting ? "準備中…" : "匯出 Excel"}
        </button>
        {recordsQuery.hasNextPage ? (
          <>
            <button
              type="button"
              onClick={() => void recordsQuery.fetchNextPage()}
              disabled={recordsQuery.isFetchingNextPage}
              className="rounded-xs px-2 py-0.5 hover:bg-hover disabled:opacity-50"
            >
              {recordsQuery.isFetchingNextPage ? "載入中…" : "載更多"}
            </button>
            {/* ⚠️ 這裡原本寫「(匯出僅含已載入 N 筆)」—— 匯出改成會先抓完之後
                那句話就**反過來變成假的**了。功能改了而畫面上的說明沒改,
                比一開始就沒寫更糟:使用者會照著它做錯的決定。 */}
          </>
        ) : null}
      </div>
    </div>
  )
}
