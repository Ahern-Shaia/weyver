"use client"

import { fieldTypeIcon } from "@/lib/engine/field-icons"
import { ADVANCED_TYPES, BUILDABLE_TYPES, fieldTypeMeta } from "@/lib/engine/field-types"
import type { CellValueType } from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { cn } from "@weyver/ui/lib/utils"
import { Rows3 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
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
  onAddSubtable,
  disabled = false,
  advanced = false,
}: {
  onPick: (type: CellValueType) => void
  /* 🔴 task #154|子表入口與「加欄位」**同一層**。

     原本它是標題列右上角的一顆按鈕,與「v1 · 2 欄」這種中繼資料並排 ——
     而「兩層以上的資料結構」是本產品對 Google Sheets 的核心差異點,
     **核心賣點被放在 metadata 的版位**。

     這裡的判準很簡單:加欄位與加子表都是「**往這張表加東西**」,
     所以它們該在同一個地方、長同一個樣子。
     ⚠️ 子表不可再有子表,故上層不給這個 callback 時整組不渲染(不是給了再 disable ——
     那會讓人以為「現在不行,等一下可以」)。 */
  onAddSubtable?: (() => void) | undefined
  disabled?: boolean
  advanced?: boolean
}) {
  const [q, setQ] = useState("")
  const term = q.trim().toLowerCase()
  const all: readonly CellValueType[] = advanced
    ? [...BUILDABLE_TYPES, ...ADVANCED_TYPES]
    : BUILDABLE_TYPES
  const matches = all.filter(
    (t) => fieldTypeMeta(t).label.toLowerCase().includes(term) || t.toLowerCase().includes(term),
  )
  const rest = BUILDABLE_TYPES.filter((t) => !COMMON.includes(t))

  return (
    <div className="w-[178px] shrink-0 overflow-y-auto border-r border-line bg-card p-2.5">
      <div className="px-1.5 pb-2 text-[12px] font-semibold tracking-wide text-ink-3">點擊加入</div>
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
          <div className="px-1.5 pb-1.5 text-[12px] font-semibold tracking-wide text-ink-3">
            常用
          </div>
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
                /* link 已於 2026-08-04 移出 STUB 並列入 ADVANCED_TYPES —— 原本這裡硬寫 "link"
                   是它還是 stub 時的 workaround,留著會重複出現 */
                types={[...ADVANCED_TYPES]}
                onPick={onPick}
                disabled={disabled}
              />
            </>
          ) : null}
          {onAddSubtable !== undefined ? (
            <>
              <div className="mt-3 px-1.5 pb-1.5 text-[12px] font-semibold tracking-wide text-ink-3">
                結構
              </div>
              <PaletteRow
                icon={Rows3}
                label="子表(明細)"
                disabled={disabled}
                onClick={onAddSubtable}
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
      {types.map((type) => (
        <PaletteRow
          key={type}
          icon={fieldTypeIcon(type)}
          label={fieldTypeMeta(type).label}
          disabled={disabled}
          onClick={() => onPick(type)}
        />
      ))}
    </div>
  )
}

/* 一列 = 一個「加進這張表」的動作。子表與欄位型別**共用這一個元件** ——
   同一層級的東西要長同一個樣子,而不是靠兩份各自維護的 class 字串碰巧一致。 */
function PaletteRow({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  readonly icon: LucideIcon
  readonly label: string
  readonly disabled: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
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
      {label}
    </button>
  )
}
