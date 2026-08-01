"use client"

import { optionTone } from "@/lib/engine/option-tone"
import type { FieldDto, RecordRow } from "@/lib/engine/schemas"
import { StatusChip } from "@weyver/ui/status-chip"
import type { ReactNode } from "react"

/* 工作台左欄:記錄清單(常駐,審一批不換頁)。標題取首欄值,fallback #id。
   R1·workbench-uplift A2:每列補**狀態 + 金額**(triage 用的兩個訊號),
   免得只靠標題無法判斷該先看哪筆。 */
export function titleOf(record: RecordRow, fields: readonly FieldDto[]): string {
  const first = fields[0]
  const v = first ? record.values[first.name] : undefined
  return v !== undefined && v !== null && v !== "" ? String(v) : `記錄 #${record.id}`
}

export function RecordList({
  formName,
  fields,
  records,
  loading,
  selectedId,
  onSelect,
}: {
  readonly formName: string
  readonly fields: readonly FieldDto[]
  readonly records: readonly RecordRow[]
  readonly loading: boolean
  readonly selectedId: number | null
  readonly onSelect: (id: number) => void
}): ReactNode {
  const statusField = fields.find((f) => f.type === "singleSelect")
  const moneyField = fields.find((f) => f.type === "money")
  const rovingId = records.find((r) => r.id === selectedId)?.id ?? records[0]?.id ?? null

  return (
    <div data-noprint className="flex w-60 shrink-0 flex-col border-r border-line bg-card">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <b className="truncate text-[13px] font-semibold">{formName}</b>
        <span className="ml-auto rounded-xs border border-line px-1.5 font-mono text-[12px] text-ink-3">
          {records.length}
        </span>
      </div>
      {/* R1·UX-1 M5|W3C ARIA APG **listbox** pattern(非 grid —— 這是單選清單不是表格)。
          必要鍵位僅 ↑↓;`Home`/`End` 於原文標為 Optional,此處一併提供。
          roving tabindex:整份清單只有一個 Tab 停點。 */}
      <div
        className="flex-1 overflow-y-auto"
        role="listbox"
        aria-label="記錄清單"
        onKeyDown={(e) => {
          if (records.length === 0) return
          const idx = records.findIndex((r) => r.id === selectedId)
          const cur = idx < 0 ? 0 : idx
          let next: number | null = null
          if (e.key === "ArrowDown") next = Math.min(records.length - 1, cur + 1)
          else if (e.key === "ArrowUp") next = Math.max(0, cur - 1)
          else if (e.key === "Home") next = 0
          else if (e.key === "End") next = records.length - 1
          if (next === null) return
          e.preventDefault()
          const target = records[next]
          if (!target) return
          onSelect(target.id)
          e.currentTarget
            .querySelector<HTMLElement>(`[data-record-option="${String(target.id)}"]`)
            ?.focus()
        }}
      >
        {loading ? (
          <div className="px-3 py-2 text-[12px] text-ink-3">載入記錄…</div>
        ) : records.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-ink-3">尚無記錄。</div>
        ) : (
          /* 🔴 roving tabindex 必須**恰有一個**停點:
             選取項若不在清單中(換表單 / 記錄被刪),退回第一項 ——
             否則整份清單沒有任何 tabIndex 0,鍵盤進不去(與 U4 的「出不去」同類缺陷)。 */
          records.map((r) => {
            const active = selectedId === r.id
            return (
              <button
                type="button"
                key={r.id}
                role="option"
                aria-selected={active}
                data-record-option={r.id}
                tabIndex={r.id === rovingId ? 0 : -1}
                onClick={() => onSelect(r.id)}
                className={
                  active
                    ? "block w-full border-b border-line-2 border-l-2 border-l-primary bg-primary-t px-3 py-1.5 text-left"
                    : "block w-full border-b border-line-2 border-l-2 border-l-transparent px-3 py-1.5 text-left hover:bg-surface"
                }
              >
                <div className="truncate text-[12px] font-medium text-ink">
                  {titleOf(r, fields)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="font-mono text-[12px] text-ink-3">#{r.id}</span>
                  {statusField ? (
                    <StatusChip
                      tone={optionTone(statusField, r.values[statusField.name])}
                      className="min-h-[16px] text-[12px]"
                    >
                      {String(r.values[statusField.name] ?? "—")}
                    </StatusChip>
                  ) : null}
                  {moneyField ? (
                    <span className="ml-auto font-mono text-[12px] tabular-nums text-ink-2">
                      {String(r.values[moneyField.name] ?? "—")}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
