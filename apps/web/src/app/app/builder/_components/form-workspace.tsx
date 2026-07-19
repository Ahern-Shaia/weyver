"use client"

import { Segmented } from "@weyver/ui/segmented"
import { useState } from "react"
import { EditFormPanel } from "./edit-form-panel"
import { RecordFormPanel } from "./record-form-panel"
import { RecordsListPanel } from "./records-list-panel"

const MODES = [
  { label: "設計", value: "design" },
  { label: "填單", value: "fill" },
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-line bg-card px-3">
        <Segmented ariaLabel="模式" value={mode} onValueChange={setMode} options={MODES} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {mode === "design" ? <EditFormPanel formId={formId} onAddSubtable={onAddSubtable} /> : null}
        {mode === "fill" ? <RecordFormPanel formId={formId} /> : null}
        {mode === "records" ? <RecordsListPanel formId={formId} /> : null}
      </div>
    </div>
  )
}
