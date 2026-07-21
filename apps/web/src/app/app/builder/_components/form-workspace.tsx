"use client"

import { Segmented } from "@weyver/ui/segmented"
import { useState } from "react"
import { useForm, useRecords } from "@/lib/engine/hooks"
import { EditFormPanel } from "./edit-form-panel"
import { RecordFormPanel } from "./record-form-panel"
import { RecordGridPanel } from "./record-grid-panel"
import { RecordsListPanel } from "./records-list-panel"

const MODES = [
  { label: "設計", value: "design" },
  { label: "填單", value: "fill" },
  { label: "網格", value: "grid" },
  { label: "資料", value: "records" },
] as const

export function FormWorkspace({
  formId,
  onAddSubtable,
}: {
  formId: number
  onAddSubtable: (parentFormId: number, parentName: string) => void
}) {
  const [mode, setMode] = useState<string>("design")
  // 文件工作台頭:表單名 + 記錄數(非 heading、不與 e2e 斷言之 heading/「vN·N 欄」文字衝突)
  const { data: form } = useForm(formId)
  const { data: recs } = useRecords(formId)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-card px-4">
        <b className="truncate text-[13px] font-semibold text-ink">{form?.name ?? "表單"}</b>
        {recs ? (
          <span className="shrink-0 rounded-xs border border-line px-1.5 font-mono text-[10px] text-ink-3">
            {recs.records.length} 筆
          </span>
        ) : null}
        <div className="ml-auto shrink-0">
          <Segmented ariaLabel="模式" value={mode} onValueChange={setMode} options={MODES} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {mode === "design" ? <EditFormPanel formId={formId} onAddSubtable={onAddSubtable} /> : null}
        {mode === "fill" ? <RecordFormPanel formId={formId} /> : null}
        {mode === "grid" ? <RecordGridPanel formId={formId} /> : null}
        {mode === "records" ? <RecordsListPanel formId={formId} /> : null}
      </div>
    </div>
  )
}
