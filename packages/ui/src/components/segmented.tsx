"use client"

import type { ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2|帶框分段切換(如 表單/列表);active=主色實底 */
export interface SegmentedOption {
  readonly label: string
  readonly value: string
}

export interface SegmentedProps {
  readonly options: readonly SegmentedOption[]
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly className?: string
  readonly ariaLabel?: string
}

export function Segmented({
  options,
  value,
  onValueChange,
  className,
  ariaLabel,
}: SegmentedProps): ReactElement {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("inline-flex overflow-hidden rounded-xs border border-line", className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "border-r border-line px-2.5 py-[3px] text-[11px] last:border-r-0",
              active ? "bg-primary font-semibold text-white" : "text-ink-3 hover:bg-head",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
