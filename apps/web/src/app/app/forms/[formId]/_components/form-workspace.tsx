"use client"

import { FileText } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs"
import { type ReactNode, useState } from "react"
import { Segmented } from "@weyver/ui/segmented"
import { useForm, useForms, useRecords } from "@/lib/engine/hooks"
import type { FormSummary } from "@/lib/engine/schemas"
import { CollectionView } from "./collection-view"
import { ObjectPage } from "./object-page"
import { RecordList } from "./record-list"

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

  const childForm = (forms ?? []).find((f) => f.parentFormId === formId) ?? null

  const openRecord = (id: number): void => {
    void setRid(id)
    void setMode("record")
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
          <CollectionView
            formId={formId}
            form={form}
            view={null}
            quickSearch={q}
            onRowOpen={openRecord}
          />
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
        <ObjectPage form={form} record={selected} childForm={childForm} formId={formId} />
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
