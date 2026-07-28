"use client"

import { Input } from "@weyver/ui/input"
import { CHIP_TONES, type ChipTone, StatusChip } from "@weyver/ui/status-chip"
import { Plus, X } from "lucide-react"
import { type ReactNode, useId } from "react"

/* R1·UP-4c 選項逐項編輯器(OQ-OC-2=A)。取代原本的 CSV 單行輸入 ——
   顏色天然是 per-option 屬性,CSV 無處可掛。

   **自動配色**(偏離 OQ-OC-7 字面建議,理由已記於 doc §10):原建議「不做」的前提是
   「只開放語意色」;OQ-OC-1 改採完整色盤後,新增 10 個選項要手動點 10 次色。
   故改為**新增時自動指派下一個類別色,使用者可再改** —— 與 Teable 同做法。
   語意色(ok/warn/error/neutral)不進入自動輪替:語意要由人指定,不該用猜的。 */

const AUTO_TONES: readonly ChipTone[] = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]
const TONE_LABEL: Partial<Record<ChipTone, string>> = {
  ok: "完成",
  warn: "待辦",
  error: "異常",
  neutral: "中性",
}

export interface ChoiceRow {
  readonly name: string
  readonly tone: ChipTone
}

export function nextAutoTone(existing: readonly ChoiceRow[]): ChipTone {
  const used = new Set(existing.map((r) => r.tone))
  return (
    AUTO_TONES.find((t) => !used.has(t)) ?? AUTO_TONES[existing.length % AUTO_TONES.length] ?? "c1"
  )
}

/* 與後端契約互轉:{ choices: string[], colors?: Record<name, tone> } */
export function rowsToOptions(rows: readonly ChoiceRow[]): {
  choices: string[]
  colors: Record<string, ChipTone>
} {
  const choices: string[] = []
  const colors: Record<string, ChipTone> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name === "" || choices.includes(name)) continue
    choices.push(name)
    colors[name] = row.tone
  }
  return { choices, colors }
}

export function optionsToRows(options: Record<string, unknown>): ChoiceRow[] {
  const choices = Array.isArray(options.choices)
    ? options.choices.filter((c): c is string => typeof c === "string")
    : []
  const colors = (options.colors ?? {}) as Record<string, unknown>
  return choices.map((name, index) => {
    const stored = colors[name]
    const tone = CHIP_TONES.includes(stored as ChipTone)
      ? (stored as ChipTone)
      : (AUTO_TONES[index % AUTO_TONES.length] ?? "c1")
    return { name, tone }
  })
}

export function ChoicesEditor({
  rows,
  onChange,
}: {
  readonly rows: readonly ChoiceRow[]
  readonly onChange: (rows: ChoiceRow[]) => void
}): ReactNode {
  const groupId = useId()

  const patch = (index: number, next: Partial<ChoiceRow>): void =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)))

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10.5px] text-ink-4">選項與顏色</span>
      {rows.map((row, index) => (
        <div key={`${groupId}-${index}`} className="flex items-center gap-1.5">
          <Input
            className="h-7 flex-1"
            value={row.name}
            onChange={(e) => patch(index, { name: e.target.value })}
            placeholder={`選項 ${index + 1}`}
            aria-label={`選項 ${index + 1} 名稱`}
          />
          <select
            value={row.tone}
            onChange={(e) => patch(index, { tone: e.target.value as ChipTone })}
            aria-label={`選項 ${index + 1} 顏色`}
            className="h-7 rounded-xs border border-line bg-card px-1 text-[11px] text-ink"
          >
            {CHIP_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {TONE_LABEL[tone] ?? tone}
              </option>
            ))}
          </select>
          {/* 即時預覽:所見即所得,免得選了色不知道長怎樣 */}
          <StatusChip tone={row.tone}>{row.name.trim() === "" ? "預覽" : row.name}</StatusChip>
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label={`移除選項 ${index + 1}`}
            className="text-ink-4 hover:text-er"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { name: "", tone: nextAutoTone(rows) }])}
        className="flex w-fit items-center gap-1 text-[11.5px] text-primary hover:underline"
      >
        <Plus size={12} />
        加選項
      </button>
    </div>
  )
}
