"use client"

import type { ReactElement, ReactNode } from "react"
import { StatusChip, type StatusTone } from "./status-chip"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.1|左欄記錄清單 228px:密、hairline、selected=主色 tint + 左 3px inset */
export interface RecordRailItem {
  readonly id: string
  readonly code: string
  readonly amount?: string
  readonly title: string
  readonly status: { readonly tone: StatusTone; readonly label: string }
  readonly meta?: string
}

export interface RecordRailProps {
  readonly header: ReactNode
  readonly items: readonly RecordRailItem[]
  readonly activeId?: string
  readonly onSelect?: (id: string) => void
  readonly footer?: ReactNode
  readonly className?: string
}

export function RecordRail({
  header,
  items,
  activeId,
  onSelect,
  footer,
  className,
}: RecordRailProps): ReactElement {
  return (
    <aside
      className={cn("flex w-[228px] shrink-0 flex-col border-r border-line bg-card", className)}
    >
      <div className="border-b border-line px-2.5 py-2">{header}</div>
      <div className="flex-1 overflow-y-auto">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect?.(item.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "block w-full border-b border-line-2 px-2.5 py-[7px] text-left",
                active
                  ? "bg-primary-t shadow-[inset_3px_0_0_var(--color-primary)]"
                  : "hover:bg-head",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "font-mono text-[11px]",
                    active ? "font-semibold text-primary" : "text-ink-2",
                  )}
                >
                  {item.code}
                </span>
                {item.amount ? (
                  <span className="font-mono text-[11.5px] font-semibold tabular-nums">
                    {item.amount}
                  </span>
                ) : null}
              </div>
              <div className="mt-[3px] flex items-center justify-between text-[11.5px]">
                <span>{item.title}</span>
                <StatusChip tone={item.status.tone}>{item.status.label}</StatusChip>
              </div>
              {item.meta ? <div className="mt-px text-[10.5px] text-ink-3">{item.meta}</div> : null}
            </button>
          )
        })}
      </div>
      {footer ? (
        <div className="flex justify-between border-t border-line px-2.5 py-1.5 text-[11px] text-ink-3">
          {footer}
        </div>
      ) : null}
    </aside>
  )
}
