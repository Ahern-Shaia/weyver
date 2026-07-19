"use client"

import { ThemeSwitcher } from "@weyver/ui/theme-switcher"
import dynamic from "next/dynamic"
import { parseAsInteger, useQueryState } from "nuqs"
import { useState } from "react"
import { FormListRail } from "./form-list-rail"
import { FormWorkspace } from "./form-workspace"
import { NewFormPanel } from "./new-form-panel"

/* 匯入面板拉入 SheetJS(~380KB)→ 動態載入,不進 builder 主 bundle(僅點「匯入」才載)*/
const ExcelImportPanel = dynamic(
  () => import("./excel-import-panel").then((m) => m.ExcelImportPanel),
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

  const select = (id: number) => {
    setNewForm(null)
    setImporting(false)
    void setFormId(id)
  }
  const startNew = () => {
    setNewForm({ parentFormId: null, parentName: null })
    setImporting(false)
    void setFormId(null)
  }
  const startImport = () => {
    setImporting(true)
    setNewForm(null)
    void setFormId(null)
  }
  const startSubtable = (parentFormId: number, parentName: string) => {
    setNewForm({ parentFormId, parentName })
    setImporting(false)
    void setFormId(null)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-[42px] shrink-0 items-center gap-3 border-b-2 border-primary bg-card px-4">
        <span className="font-semibold text-[13.5px]">
          Weyver <span className="text-ink-3 text-[11px] font-normal">表單建構器</span>
        </span>
        <span className="rounded-xs border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-ink-4">
          R1 · P0-1
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ThemeSwitcher />
          <span className="text-[11.5px] text-ink-2">
            租戶 <b className="font-mono font-medium">1</b> · dev
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <FormListRail
          activeFormId={formId}
          onSelect={select}
          onNew={startNew}
          onImport={startImport}
        />

        <div className="min-w-0 flex-1">
          {importing ? (
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
            <div className="flex h-full items-center justify-center bg-surface">
              <div className="max-w-[320px] text-center">
                <p className="text-[13px] font-medium text-ink-2">選擇左側表單開始編輯</p>
                <p className="mt-1 text-[11.5px] text-ink-4">
                  或點「+ 新增」建立一張新表單 —— 發布後引擎即生成真實資料表。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
