"use client"

import { FileText } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Segmented } from "@weyver/ui/segmented"
import { describeEngineError } from "@/lib/engine/client"
import {
  useCreateView,
  useDeleteView,
  useForm,
  useForms,
  useRecords,
  useUpdateView,
  useViews,
} from "@/lib/engine/hooks"
import type { FormSummary, ViewConfig } from "@/lib/engine/schemas"
import { CollectionView } from "./collection-view"
import { ListControls } from "./list-controls"
import { ObjectPage } from "./object-page"
import { RecordList } from "./record-list"

const EMPTY_CONFIG: ViewConfig = {
  fields: [],
  filter: { combinator: "and", conditions: [] },
  sorts: [],
}

/* R1·UP-2 表單工作台雙模式(OQ-VL-7:列表為進表預設)。
   列表 = 集合(browse)網格 → 點「檢視」下鑽記錄頁;記錄 = master-detail(RecordList + Object Page)。
   mode/rid 存 URL(可深連結單筆);快速搜尋為列表模式本地狀態。 */
const MODE_VALUES = ["list", "record"] as const
const MODE_OPTIONS = [
  { label: "列表", value: "list" },
  { label: "記錄", value: "record" },
] as const

export function FormWorkspace(): ReactNode {
  const params = useParams<{ formId: string }>()
  const formId = Number(params.formId)
  const valid = Number.isSafeInteger(formId)
  const { data: form, isPending: formPending } = useForm(valid ? formId : null)
  const { data: forms } = useForms()
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
  const createView = useCreateView(formId)
  const updateView = useUpdateView(formId)
  const deleteView = useDeleteView(formId)

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
              className="h-7 w-56 rounded-xs border border-line bg-surface px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-4 focus:border-primary"
            />
          ) : null}
          <Link
            href="/app/builder"
            className="shrink-0 rounded-xs border border-line px-2.5 py-1 text-[11.5px] text-ink-3 hover:border-primary hover:text-primary"
          >
            設計器
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
              <div className="shrink-0 border-b border-line bg-label px-4 py-1.5 text-[11.5px] text-ink-2">
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

  return (
    <div className="flex min-h-0 flex-1">
      <RecordList
        formName={form?.name ?? "表單"}
        fields={form?.fields ?? []}
        records={records}
        loading={recPending}
        selectedId={selected?.id ?? null}
        onSelect={onSelect}
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
        />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-surface p-8 text-center">
          <div className="max-w-[320px]">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-md border border-line bg-card text-ink-4">
              <FileText size={22} strokeWidth={1.5} />
            </div>
            <p className="text-[12.5px] text-ink-3">此表單尚無記錄。切「列表」或到設計器新增。</p>
            <Link
              href={`/app/builder?form=${formId}`}
              className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12.5px] font-medium text-white"
            >
              在設計器開啟
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
