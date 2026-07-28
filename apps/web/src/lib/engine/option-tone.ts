import { type ChipTone, isChipTone } from "@weyver/ui/status-chip"
import type { FieldDto } from "./schemas"

/* R1·UP-4c|選項 → 色 tone 解析(單一入口)。

   **安全**(FMEA C1):`options.colors` 為使用者可設定之輸入。此處**只回傳受控 tone**,
   由 StatusChip 內部查表映射成 class;呼叫端**永遠不得**把回傳值拼進 className / style。
   查無 / 非法 → `neutral`(後端另有 enum 收斂,兩側皆不接受任意值)。 */
export function optionTone(field: FieldDto, value: unknown): ChipTone {
  if (typeof value !== "string") return "neutral"
  const colors = (field.options as { colors?: Record<string, unknown> }).colors
  const stored = colors?.[value]
  return isChipTone(stored) ? stored : "neutral"
}

/* 該欄位是否以「章」呈現(單選 / 多選皆是;多選為多個章)。 */
export function isChipField(field: FieldDto): boolean {
  return field.type === "singleSelect" || field.type === "multiSelect"
}

/* 多選值正規化為字串陣列;單選回單一元素陣列。 */
export function chipValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string")
  return typeof value === "string" && value !== "" ? [value] : []
}
