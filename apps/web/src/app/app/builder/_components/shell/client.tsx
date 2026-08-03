"use client"

import { FormListRail } from "@/app/app/builder/_components/shell/form-list"
import { NewFormPanel } from "@/app/app/builder/_components/shell/new-form"
import { TemplatePicker } from "@/app/app/builder/_components/shell/template-picker"
import { FormWorkspace } from "@/app/app/builder/_components/shell/workspace"
import { Button } from "@weyver/ui/button"
import { Table2 } from "lucide-react"
import dynamic from "next/dynamic"
import { parseAsInteger, useQueryState } from "nuqs"
import { useState } from "react"

/* 匯入面板拉入 SheetJS(~380KB)→ 動態載入,不進 builder 主 bundle(僅點「匯入」才載)*/
const ExcelImportPanel = dynamic(
  () => import("@/app/app/builder/_components/excel/panel").then((m) => m.ExcelImportPanel),
  { ssr: false, loading: () => <div className="p-6 text-[12px] text-ink-3">載入匯入工具…</div> },
)

interface NewFormState {
  readonly parentFormId: number | null
  readonly parentName: string | null
}

export function BuilderClient() {
  const [formId, setFormId] = useQueryState("form", parseAsInteger)
  const [newForm, setNewForm] = useState<NewFormState | null>(null)
  const [importing, setImporting] = useState(false)

  const [pickingTemplate, setPickingTemplate] = useState(false)
  const select = (id: number) => {
    setNewForm(null)
    setImporting(false)
    setPickingTemplate(false)
    void setFormId(id)
  }
  const startNew = () => {
    setNewForm({ parentFormId: null, parentName: null })
    setImporting(false)
    setPickingTemplate(false)
    void setFormId(null)
  }
  const startImport = () => {
    setImporting(true)
    setNewForm(null)
    setPickingTemplate(false)
    void setFormId(null)
  }
  const startTemplate = () => {
    setPickingTemplate(true)
    setNewForm(null)
    setImporting(false)
    void setFormId(null)
  }
  const startSubtable = (parentFormId: number, parentName: string) => {
    setNewForm({ parentFormId, parentName })
    setImporting(false)
    void setFormId(null)
  }

  return (
    <div className="flex h-full flex-col overflow-y-hidden overflow-x-auto">
      <div className="flex min-h-0 flex-1">
        <FormListRail
          activeFormId={formId}
          onSelect={select}
          onNew={startNew}
          onImport={startImport}
          onTemplate={startTemplate}
        />

        <div className="min-w-0 flex-1">
          {pickingTemplate ? (
            <TemplatePicker onApplied={select} onCancel={() => setPickingTemplate(false)} />
          ) : importing ? (
            <ExcelImportPanel onCreated={select} onCancel={() => setImporting(false)} />
          ) : newForm !== null ? (
            <NewFormPanel
              onCreated={select}
              onCancel={() => setNewForm(null)}
              parentFormId={newForm.parentFormId ?? undefined}
              parentName={newForm.parentName ?? undefined}
            />
          ) : formId !== null ? (
            <FormWorkspace key={formId} formId={formId} onAddSubtable={startSubtable} />
          ) : (
            <div className="flex h-full items-center justify-center bg-surface p-8">
              <div className="max-w-[380px] text-center">
                <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-md border border-line bg-card text-ink-3">
                  <Table2 size={26} strokeWidth={1.5} />
                </div>
                <h2 className="text-[16px] font-semibold text-ink">選擇或建立表單</h2>
                <p className="mx-auto mt-1.5 max-w-[300px] text-[12px] leading-relaxed text-ink-3">
                  從左側點選既有表單開始編輯與填單,或新建一張 —— 發布後引擎即生成真實資料表。
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Button variant="primary" onClick={startNew}>
                    ＋ 新增表單
                  </Button>
                  <Button onClick={startImport}>匯入 Excel</Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
