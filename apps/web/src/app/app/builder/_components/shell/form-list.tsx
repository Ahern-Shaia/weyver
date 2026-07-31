"use client"

import { cn } from "@weyver/ui/lib/utils"
import { describeEngineError } from "@/lib/engine/client"
import { useForms } from "@/lib/engine/hooks"

const STATE_MARK: Record<string, string> = {
  ready: "●",
  pending: "◐",
  failed: "✕",
}

const STATE_COLOR: Record<string, string> = {
  ready: "text-ok",
  pending: "text-warn",
  failed: "text-er",
}

export function FormListRail({
  activeFormId,
  onSelect,
  onNew,
  onImport,
}: {
  activeFormId: number | null
  onSelect: (formId: number) => void
  onNew: () => void
  onImport: () => void
}) {
  const forms = useForms()

  return (
    <div className="flex w-[228px] shrink-0 flex-col border-r border-line bg-card">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="text-[12px] font-semibold text-ink-2">我的表單</span>
        <button
          type="button"
          onClick={onImport}
          className="ml-auto rounded-xs border border-line px-2 py-0.5 text-[12px] font-medium text-ink-2 hover:bg-head"
        >
          匯入 Excel
        </button>
        <button
          type="button"
          onClick={onNew}
          className="rounded-xs border border-primary bg-primary px-2 py-0.5 text-[12px] font-medium text-white"
        >
          + 新增
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {forms.isLoading ? (
          <div className="p-3 text-[12px] text-ink-3">載入中…</div>
        ) : forms.isError ? (
          <div className="p-3 text-[13px] text-er">
            無法連線引擎:{describeEngineError(forms.error)}
          </div>
        ) : (forms.data?.length ?? 0) === 0 ? (
          <div className="p-3 text-[12px] text-ink-3">尚無表單。點「+ 新增」建立第一張。</div>
        ) : (
          <ul>
            {forms.data?.map((form) => {
              const active = form.id === activeFormId
              return (
                <li key={form.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(form.id)}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-cell px-3 py-2 text-left text-[12px]",
                      active ? "bg-primary-t font-medium text-ink" : "text-ink-2 hover:bg-head",
                    )}
                  >
                    <span
                      className={cn("font-mono text-[12px]", STATE_COLOR[form.provisionState])}
                      title={form.provisionState}
                    >
                      {STATE_MARK[form.provisionState] ?? "●"}
                    </span>
                    <span className="flex-1 truncate">{form.name}</span>
                    {form.parentFormId !== null ? (
                      <span className="shrink-0 text-[12px] text-ink-3">子表</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
