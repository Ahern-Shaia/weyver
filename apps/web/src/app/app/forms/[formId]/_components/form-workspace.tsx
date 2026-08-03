"use client"

import dynamic from "next/dynamic"

import { canOnForm, useMyCapabilities } from "@/lib/engine/authz"
import { describeEngineError } from "@/lib/engine/client"
import {
  formKeys,
  useCreateView,
  useDeleteView,
  useForm,
  useForms,
  useInvalidate,
  useRecords,
  useUpdateView,
  useViews,
} from "@/lib/engine/hooks"
import type { FormSummary, ViewConfig } from "@/lib/engine/schemas"
import { recordFormVisit } from "@/lib/recent-forms"
import { useTenantScope } from "@/lib/use-tenant-scope"
import { Segmented } from "@weyver/ui/segmented"
import { FileText } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CollectionView } from "./collection-view"
import { FormToolsMenu } from "./form-tools-menu"
import { ImportBatches, importBatchKey } from "./import-batches"
import { ImportPanel } from "./import-panel"
import { ListControls } from "./list-controls"
import { ObjectPage } from "./object-page"
import { RecordList } from "./record-list"

/* 🔴 **次要視圖延後載入**。預設是列表模式,而看板 / 行事曆 / 樞紐 / 圖表
   各自帶著自己的相依(圖表還多一份繪圖庫)—— 靜態匯入等於讓每個只是來看列表的人
   先下載四種他不會開的視圖。切過去時才載,`ssr: false`(都只在瀏覽器有意義)。 */
/* ⚠️ `next/dynamic` 的 options **必須是 object literal** —— 抽成共用常數會在 build
   時被擋下(invalid-dynamic-options-type),所以這裡刻意重複四次。 */
const loadingView = (): ReactNode => (
  <div className="flex-1 bg-surface p-6 text-[12px] text-ink-3">載入視圖…</div>
)

const CalendarView = dynamic(() => import("./calendar-view").then((m) => m.CalendarView), {
  ssr: false,
  loading: loadingView,
})
const ChartView = dynamic(() => import("./chart-view").then((m) => m.ChartView), {
  ssr: false,
  loading: loadingView,
})
const PivotView = dynamic(() => import("./pivot-view").then((m) => m.PivotView), {
  ssr: false,
  loading: loadingView,
})
const KanbanBoard = dynamic(() => import("./kanban-board").then((m) => m.KanbanBoard), {
  ssr: false,
  loading: loadingView,
})

const EMPTY_CONFIG: ViewConfig = {
  fields: [],
  filter: { combinator: "and", conditions: [] },
  sorts: [],
  groupBy: [],
  aggregates: [],
}

/* R1·UP-2 表單工作台雙模式(OQ-VL-7:列表為進表預設)。
   列表 = 集合(browse)網格 → 點「檢視」下鑽記錄頁;記錄 = master-detail(RecordList + Object Page)。
   mode/rid 存 URL(可深連結單筆);快速搜尋為列表模式本地狀態。 */
const MODE_VALUES = ["list", "kanban", "calendar", "pivot", "chart", "record"] as const
const MODE_OPTIONS = [
  { label: "列表", value: "list" },
  { label: "看板", value: "kanban" },
  { label: "行事曆", value: "calendar" },
  { label: "樞紐", value: "pivot" },
  { label: "圖表", value: "chart" },
  { label: "記錄", value: "record" },
] as const

export function FormWorkspace(): ReactNode {
  const params = useParams<{ formId: string }>()
  const formId = Number(params.formId)
  const valid = Number.isSafeInteger(formId)
  const { data: form, isPending: formPending } = useForm(valid ? formId : null)
  const { data: forms } = useForms()
  const caps = useMyCapabilities()
  const [mode, setMode] = useQueryState(
    "mode",
    parseAsStringLiteral(MODE_VALUES).withDefault("list"),
  )
  const [rid, setRid] = useQueryState("rid", parseAsInteger)
  const [q, setQ] = useState("")

  const { data: views = [] } = useViews(valid ? formId : null)
  const [activeViewId, setActiveViewId] = useState<number | null>(null)
  const [workingConfig, setWorkingConfig] = useState<ViewConfig>(EMPTY_CONFIG)
  const [msg, setMsg] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const invalidate = useInvalidate()
  const createView = useCreateView(formId)
  const updateView = useUpdateView(formId)
  const deleteView = useDeleteView(formId)

  /* R1·UX-1 M4|記錄「最近使用」。**表單真的載到才記** —— 若 404 或無權,
     記下去只會讓首頁出現點不開的項目。 */
  const scope = useTenantScope()
  useEffect(() => {
    if (form) recordFormVisit(scope, formId)
  }, [form, formId, scope])

  // 一次性:載入時套用共通預設檢視(OQ-VL-4 lazy default;之後尊重使用者選擇)
  const appliedDefault = useRef(false)
  useEffect(() => {
    if (appliedDefault.current || views.length === 0) return
    appliedDefault.current = true
    const def = views.find((v) => v.isDefault)
    if (def) {
      setActiveViewId(def.id)
      setWorkingConfig(def.config)
    }
  }, [views])

  const childForm = (forms ?? []).find((f) => f.parentFormId === formId) ?? null

  const openRecord = (id: number): void => {
    void setRid(id)
    void setMode("record")
  }

  const selectView = (id: number | null): void => {
    setActiveViewId(id)
    setWorkingConfig(views.find((v) => v.id === id)?.config ?? EMPTY_CONFIG)
  }
  const onSaveNew = (name: string, scope: "personal" | "shared"): void => {
    createView.mutate(
      { name, scope, config: workingConfig, isDefault: false },
      {
        onSuccess: (v) => {
          setActiveViewId(v.id)
          setMsg(`已儲存檢視「${name}」`)
        },
        onError: (e) => setMsg(describeEngineError(e)),
      },
    )
  }
  const onUpdate = (): void => {
    if (activeViewId === null) return
    updateView.mutate(
      { viewId: activeViewId, patch: { config: workingConfig } },
      { onSuccess: () => setMsg("已更新檢視"), onError: (e) => setMsg(describeEngineError(e)) },
    )
  }
  const onSetDefault = (): void => {
    if (activeViewId === null) return
    updateView.mutate(
      { viewId: activeViewId, patch: { scope: "shared", isDefault: true } },
      { onSuccess: () => setMsg("已設為預設檢視"), onError: (e) => setMsg(describeEngineError(e)) },
    )
  }
  const onDelete = (): void => {
    if (activeViewId === null || !window.confirm("刪除此檢視?")) return
    deleteView.mutate(activeViewId, {
      onSuccess: () => {
        setActiveViewId(null)
        setWorkingConfig(EMPTY_CONFIG)
        setMsg("已刪除檢視")
      },
      onError: (e) => setMsg(describeEngineError(e)),
    })
  }

  if (importing && form !== undefined) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-auto">
        <ImportPanel
          formId={formId}
          formName={form.name}
          onDone={() => invalidate([formKeys.records(formId), importBatchKey(formId)])}
          onClose={() => setImporting(false)}
        />
        {/* 匯入紀錄與撤銷:後端一直有 revert 端點卻沒有清單,等於撤銷不可用(#106) */}
        <div className="px-4 pb-4">
          <ImportBatches
            formId={formId}
            onReverted={() => invalidate([formKeys.records(formId)])}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-card px-4">
        <b className="truncate text-[13px] font-semibold text-ink">{form?.name ?? "表單"}</b>
        <Segmented
          ariaLabel="檢視模式"
          value={mode}
          onValueChange={(v) => void setMode(v as (typeof MODE_VALUES)[number])}
          options={MODE_OPTIONS}
        />
        <div className="ml-auto flex items-center gap-2">
          {mode === "list" ? (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋此表單…"
              className="h-7 w-56 rounded-xs border border-line bg-surface px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-primary"
            />
          ) : null}
          {/* 🔴 R1·IA-1|表單層工具聚合入口(docs/33)。原本「匯入資料」是散在這裡的
              單顆按鈕,而標籤在設計器、公開設定在設定中心 —— 使用者得自己記住哪個在哪。 */}
          <FormToolsMenu
            formId={formId}
            /* ✅ 2026-08-03:`/api/authz/me` 已落地,此處改吃真實能力。
               原本寫死 `true` —— 後端有執法,但畫面會顯示按下去 403 的入口。
               載入中回 `false`(見 `canOnForm`):寧可少顯示一個入口。 */
            canDesign={canOnForm(caps.data, formId, "design")}
            onImport={() => setImporting(true)}
          />
          {/* 深連到**目前這張表**的設計模式(#109)。原本連到 builder 根目錄,
              使用者到了那裡還要自己在清單裡找回剛才那張表。 */}
          <Link
            href={`/app/builder?form=${formId}&mode=design`}
            className="shrink-0 rounded-xs px-2.5 py-1 text-[12px] text-ink-3 hover:text-primary hover:bg-hover"
          >
            設計
          </Link>
        </div>
      </div>

      {mode === "list" ? (
        formPending || form === undefined ? (
          <div className="flex-1 bg-surface p-6 text-[12px] text-ink-3">載入…</div>
        ) : (
          <>
            <ListControls
              form={form}
              views={views}
              activeViewId={activeViewId}
              config={workingConfig}
              isAdmin
              onSelectView={selectView}
              onConfigChange={setWorkingConfig}
              onSaveNew={onSaveNew}
              onUpdate={onUpdate}
              onSetDefault={onSetDefault}
              onDelete={onDelete}
            />
            {msg !== null ? (
              <div className="shrink-0 border-b border-line bg-label px-4 py-1.5 text-[12px] text-ink-2">
                {msg}
              </div>
            ) : null}
            <CollectionView
              formId={formId}
              form={form}
              view={workingConfig}
              quickSearch={q}
              onRowOpen={openRecord}
            />
          </>
        )
      ) : mode === "kanban" ? (
        form === undefined ? (
          <div className="p-6 text-[12px] text-ink-3">載入…</div>
        ) : (
          <KanbanBoard formId={formId} form={form} onOpen={openRecord} />
        )
      ) : mode === "calendar" ? (
        form === undefined ? (
          <div className="p-6 text-[12px] text-ink-3">載入…</div>
        ) : (
          <CalendarView formId={formId} form={form} onOpen={openRecord} />
        )
      ) : mode === "pivot" ? (
        form === undefined ? (
          <div className="p-6 text-[12px] text-ink-3">載入…</div>
        ) : (
          <PivotView
            formId={formId}
            form={form}
            query={{ filters: [], combinator: "and", sort: [] }}
          />
        )
      ) : mode === "chart" ? (
        form === undefined ? (
          <div className="p-6 text-[12px] text-ink-3">載入…</div>
        ) : (
          <ChartView formId={formId} form={form} />
        )
      ) : (
        <RecordDetail
          formId={formId}
          selectedId={rid}
          onSelect={(id) => void setRid(id)}
          childForm={childForm}
        />
      )}
    </div>
  )
}

/* 記錄模式:master-detail(承既有 workbench)。 */
function RecordDetail({
  formId,
  selectedId,
  onSelect,
  childForm,
}: {
  readonly formId: number
  readonly selectedId: number | null
  readonly onSelect: (id: number) => void
  readonly childForm: FormSummary | null
}): ReactNode {
  const { data: form, isPending: formPending } = useForm(formId)
  const { data: resp, isPending: recPending } = useRecords(formId)
  const records = resp?.records ?? []
  const selected = records.find((r) => r.id === selectedId) ?? records[0] ?? null

  /* 🔴 編輯中切換記錄會**靜默丟棄**整筆編輯 —— ObjectPage 以 `key` 重掛,
     它自己的 state 在那一刻就沒了,擋不到。故 dirty 由子層往上報,在這裡攔。
     Fiori 逐字:「show a data loss message whenever the user navigates away
     from the edit page or clicks Cancel」。 */
  const dirtyRef = useRef(false)
  const selectGuarded = (id: number): void => {
    if (id === selected?.id) return
    if (dirtyRef.current && !window.confirm("有未儲存的變更,確定要離開這筆記錄?")) return
    dirtyRef.current = false
    onSelect(id)
  }

  return (
    <div className="flex min-h-0 flex-1">
      <RecordList
        formName={form?.name ?? "表單"}
        fields={form?.fields ?? []}
        records={records}
        loading={recPending}
        selectedId={selected?.id ?? null}
        onSelect={selectGuarded}
        hideOnNarrow={selected !== undefined && selected !== null}
      />
      {formPending ? (
        <div className="flex-1 bg-surface p-6 text-[12px] text-ink-3">載入…</div>
      ) : selected && form ? (
        <ObjectPage
          /* 🔴 `key` 不可省:ObjectPage 內的 editing/draft 為 local state。
             無 key 時切換記錄不重掛 → 編輯 A 未存、點 B、按儲存會把 A 的值寫進 B
             (且帶 B 的 version,樂觀鎖擋不住)。master-detail 版型特有的失效。 */
          key={selected.id}
          form={form}
          record={selected}
          childForm={childForm}
          formId={formId}
          onDirtyChange={(d) => {
            dirtyRef.current = d
          }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-surface p-8 text-center">
          <div className="max-w-[320px]">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-md border border-line bg-card text-ink-3">
              <FileText size={22} strokeWidth={1.5} />
            </div>
            <p className="text-[13px] text-ink-3">此表單尚無記錄。切「列表」或到設計器新增。</p>
            <Link
              href={`/app/builder?form=${formId}`}
              className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-white"
            >
              在設計器開啟
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
