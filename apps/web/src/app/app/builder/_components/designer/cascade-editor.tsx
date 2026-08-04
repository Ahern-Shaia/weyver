"use client"

import { Select } from "@weyver/ui/select"
import type { ReactNode } from "react"

import type { FieldDto } from "@/lib/engine/schemas"

/* 🔴 audit-D §2.4|**連動選項的設定入口**。

   `parentField` 與 `choices[].parents` 自 M2 出貨以來只有 schema ——
   設計器沒有這一格,填單不過濾,後端也不驗。打 API 設了不會有任何效果,
   而第一約束逐字說「有 API 可以做」不算解決。

   自 `options-editor.tsx` 拆出:該檔已 310 行,而「選項本身」與
   「選項受哪個欄位連動」是兩件會分開改的事。 */

export interface CascadeRow {
  readonly id: string
  readonly name: string
  readonly parents?: readonly string[] | undefined
}

export function CascadeEditor({
  fieldName,
  siblings,
  parentField,
  rows,
  onParentFieldChange,
  onToggleParent,
  disabled = false,
}: {
  readonly fieldName: string
  /* 可當父欄的候選:同一張表的其他單選欄。**不含自己** */
  readonly siblings: readonly FieldDto[]
  readonly parentField: string | null
  readonly rows: readonly CascadeRow[]
  readonly onParentFieldChange: (next: string | null) => void
  readonly onToggleParent: (choiceId: string, parentOptionId: string) => void
  readonly disabled?: boolean
}): ReactNode {
  const candidates = siblings.filter((f) => f.type === "singleSelect" && f.name !== fieldName)
  const parent = candidates.find((f) => f.name === parentField)
  const parentChoices = (
    (parent?.options as { choices?: { id: string; name: string }[] } | undefined)?.choices ?? []
  ).filter((c) => typeof c.id === "string" && typeof c.name === "string")

  return (
    <div className="border-t border-line p-3 text-[12px]">
      <label className="mb-1 block text-ink-3" htmlFor={`cascade-${fieldName}`}>
        連動於
      </label>
      <Select
        id={`cascade-${fieldName}`}
        className="h-7 w-full"
        value={parentField ?? ""}
        disabled={disabled || candidates.length === 0}
        onChange={(e) => onParentFieldChange(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">不連動</option>
        {candidates.map((f) => (
          <option key={f.id} value={f.name}>
            {f.name}
          </option>
        ))}
      </Select>

      {candidates.length === 0 ? (
        /* 說出**為什麼**不能選,不要只給一個空的下拉 */
        <p className="mt-1 text-ink-3">本表沒有其他單選欄可當父欄。</p>
      ) : null}

      {parent !== undefined && parentChoices.length > 0 ? (
        <div className="mt-2.5">
          <div className="mb-1 text-ink-3">
            每個選項在「{parent.name}」為哪些值時可選(都不選 = 不受限)
          </div>
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-1">
                <span className="w-20 shrink-0 truncate text-ink-2">{row.name}</span>
                {parentChoices.map((pc) => {
                  const on = (row.parents ?? []).includes(pc.id)
                  return (
                    <button
                      key={pc.id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={on}
                      aria-label={`${row.name} 連動 ${pc.name}`}
                      onClick={() => onToggleParent(row.id, pc.id)}
                      className={`rounded-xs border px-1.5 py-0.5 ${
                        on
                          ? "border-primary bg-primary-t text-primary"
                          : "border-line text-ink-3 hover:bg-hover"
                      }`}
                    >
                      {pc.name}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
