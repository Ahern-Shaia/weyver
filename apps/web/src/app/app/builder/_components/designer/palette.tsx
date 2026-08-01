"use client"

import { fieldTypeIcon } from "@/lib/engine/field-icons"
import { ADVANCED_TYPES, BUILDABLE_TYPES, fieldTypeMeta } from "@/lib/engine/field-types"
import type { CellValueType } from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { cn } from "@weyver/ui/lib/utils"
import { useState } from "react"

/* 常用置頂(#109)。28 種型別平鋪會觸 Hick's law —— 選擇時間隨選項數成長,
   而實務上絕大多數欄位落在這 8 種。Airtable / Notion 官方皆有欄位搜尋。 */
const COMMON: readonly CellValueType[] = [
  "text",
  "longText",
  "number",
  "money",
  "date",
  "singleSelect",
  "multiSelect",
  "checkbox",
]

export function FieldPalette({
  onPick,
  disabled = false,
  advanced = false,
}: {
  onPick: (type: CellValueType) => void
  disabled?: boolean
  advanced?: boolean
}) {
  const [q, setQ] = useState("")
  const term = q.trim().toLowerCase()
  const all: readonly CellValueType[] = advanced
    ? [...BUILDABLE_TYPES, ...ADVANCED_TYPES, "link"]
    : BUILDABLE_TYPES
  const matches = all.filter(
    (t) => fieldTypeMeta(t).label.toLowerCase().includes(term) || t.toLowerCase().includes(term),
  )
  const rest = BUILDABLE_TYPES.filter((t) => !COMMON.includes(t))

  return (
    <div className="w-[178px] shrink-0 overflow-y-auto border-r border-line bg-card p-2.5">
      <div className="px-1.5 pb-2 text-[12px] font-semibold tracking-wide text-ink-3">
        欄位型別 · 點擊加入
      </div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋型別…"
        aria-label="搜尋欄位型別"
        className="mb-2 h-7"
      />

      {term !== "" ? (
        matches.length === 0 ? (
          <div className="px-1.5 py-2 text-[13px] text-ink-3">找不到「{q.trim()}」</div>
        ) : (
          <PaletteGroup types={matches} onPick={onPick} disabled={disabled} />
        )
      ) : (
        <>
          <PaletteGroup types={COMMON} onPick={onPick} disabled={disabled} />
          <div className="mt-3 px-1.5 pb-1.5 text-[12px] font-semibold tracking-wide text-ink-3">
            其他
          </div>
          <PaletteGroup types={rest} onPick={onPick} disabled={disabled} />
          {advanced ? (
            <>
              <div className="mt-3 px-1.5 pb-1.5 text-[12px] font-semibold tracking-wide text-ink-3">
                進階 · 計算/關聯/指派
              </div>
              <PaletteGroup
                types={[...ADVANCED_TYPES, "link"]}
                onPick={onPick}
                disabled={disabled}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

function PaletteGroup({
  types,
  onPick,
  disabled,
}: {
  readonly types: readonly CellValueType[]
  readonly onPick: (type: CellValueType) => void
  readonly disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {types.map((type) => {
        const meta = fieldTypeMeta(type)
        const Icon = fieldTypeIcon(type)
        return (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onPick(type)}
            className={cn(
              "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 transition-colors duration-fast-01 ease-productive-exit",
              disabled
                ? "cursor-not-allowed opacity-45"
                : "cursor-pointer hover:bg-primary-t hover:text-primary",
            )}
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-label text-ink-3 transition-colors duration-fast-01 ease-productive-exit group-hover:bg-primary group-hover:text-white">
              <Icon size={13} aria-hidden />
            </span>
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}
