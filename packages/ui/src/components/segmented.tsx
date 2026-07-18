"use client"

import type { ReactElement } from "react"
import { cn } from "../lib/utils"

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
      className={cn("inline-flex gap-0.5 rounded-sm border border-border bg-card p-0.5", className)}
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
              "rounded-[4px] px-3 py-1 text-[12.5px] transition-colors duration-[130ms]",
              active
                ? "bg-brand-tint font-semibold text-brand"
                : "font-normal text-ink-3 hover:text-ink-2",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
