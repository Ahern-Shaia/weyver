"use client"

import { ThemeSwitcher } from "@weyver/ui/theme-switcher"
import { parseAsInteger, useQueryState } from "nuqs"
import { useState } from "react"
import { FormListRail } from "./form-list-rail"
import { FormWorkspace } from "./form-workspace"
import { NewFormPanel } from "./new-form-panel"

export function BuilderClient() {
  const [formId, setFormId] = useQueryState("form", parseAsInteger)
  const [creating, setCreating] = useState(false)

  const select = (id: number) => {
    setCreating(false)
    void setFormId(id)
  }
  const startNew = () => {
    setCreating(true)
    void setFormId(null)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
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
        <FormListRail activeFormId={formId} onSelect={select} onNew={startNew} />

        <div className="min-w-0 flex-1">
          {creating ? (
            <NewFormPanel onCreated={select} onCancel={() => setCreating(false)} />
          ) : formId !== null ? (
            <FormWorkspace key={formId} formId={formId} />
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
