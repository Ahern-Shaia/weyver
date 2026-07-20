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
    <div className="w-[178px] shrink-0 overflow-y-auto border-r border-line bg-card p-2.5">
      <div className="px-1.5 pb-2 text-[10px] font-semibold tracking-wide text-ink-4">
        欄位型別 · 點擊加入
      </div>
      <div className="flex flex-col gap-0.5">
        {BUILDABLE_TYPES.map((type) => {
          const meta = fieldTypeMeta(type)
          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              onClick={() => onPick(type)}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors duration-150",
                disabled
                  ? "cursor-not-allowed opacity-45"
                  : "cursor-pointer hover:bg-primary-t hover:text-primary",
              )}
            >
              <span className="inline-flex size-6 items-center justify-center rounded-md bg-label font-mono text-[10px] font-semibold text-ink-3 transition-colors duration-150 group-hover:bg-primary group-hover:text-white">
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
