"use client"

import { Input } from "@weyver/ui/input"
import { cn } from "@weyver/ui/lib/utils"
import { isStubType } from "@/lib/engine/field-types"
import type { FieldDto } from "@/lib/engine/schemas"
import { choicesOf } from "./field-value"

/* metadata(cellValueType)→ 輸入元件 map(A4)。值以「原始編輯字串 / 陣列 / 布林」保存於
   填單 state;送出前由 toSubmitValue(field-value.ts)轉成後端型別。 */

const baseInputClass =
  "h-[27px] w-full rounded-xs border border-line bg-card px-2 text-[12px] text-ink"

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDto
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (isStubType(field.type)) {
    return <span className="text-[11.5px] text-ink-4">(此型別即將推出,暫不可填)</span>
  }

  switch (field.type) {
    case "autoNumber":
      return <span className="font-mono text-[11.5px] text-ink-4">儲存後自動產生</span>

    case "longText":
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={cn(baseInputClass, "h-auto py-1.5")}
        />
      )

    case "number":
    case "percent":
    case "rating":
    case "money": {
      const inputMode = field.type === "money" ? "decimal" : "numeric"
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          placeholder={field.type === "money" ? "0.0000" : ""}
        />
      )
    }

    case "date":
      return (
        <input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        />
      )

    case "dateTime":
      return (
        <input
          type="datetime-local"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={baseInputClass}
        />
      )

    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-(--color-primary)"
        />
      )

    case "singleSelect":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className={baseInputClass}
        >
          <option value="">—</option>
          {choicesOf(field).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      )

    case "multiSelect": {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="flex flex-wrap gap-2">
          {choicesOf(field).map((choice) => {
            const on = selected.includes(choice)
            return (
              <label
                key={choice}
                className={cn(
                  "flex cursor-pointer items-center gap-1 rounded-xs border px-1.5 py-0.5 text-[11px]",
                  on ? "border-primary bg-primary-t text-primary" : "border-line text-ink-2",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, choice]
                        : selected.filter((c) => c !== choice),
                    )
                  }
                  className="accent-(--color-primary)"
                />
                {choice}
              </label>
            )
          })}
        </div>
      )
    }

    default:
      // text / email / url / phone
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}
