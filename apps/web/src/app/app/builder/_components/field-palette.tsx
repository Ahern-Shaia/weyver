"use client"

import { cn } from "@weyver/ui/lib/utils"
import { BUILDABLE_TYPES, fieldTypeMeta } from "@/lib/engine/field-types"
import type { CellValueType } from "@/lib/engine/schemas"

export function FieldPalette({
  onPick,
  disabled = false,
}: {
  onPick: (type: CellValueType) => void
  disabled?: boolean
}) {
  return (
    <div className="w-[168px] shrink-0 overflow-y-auto border-r border-line bg-card p-2">
      <div className="px-1 pb-1.5 text-[10.5px] font-semibold text-ink-3">欄位型別(點擊加入)</div>
      <div className="flex flex-col gap-1">
        {BUILDABLE_TYPES.map((type) => {
          const meta = fieldTypeMeta(type)
          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              onClick={() => onPick(type)}
              className={cn(
                "flex items-center gap-2 rounded-xs border border-line bg-card px-2 py-1 text-left text-[11.5px] text-ink-2",
                disabled ? "cursor-not-allowed opacity-50" : "hover:bg-head",
              )}
            >
              <span className="inline-flex h-4 w-5 items-center justify-center rounded-xs bg-label font-mono text-[9.5px] font-semibold text-ink-3">
                {meta.mark}
              </span>
              {meta.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
