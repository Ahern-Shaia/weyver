import { type ChipTone, isChipTone } from "@weyver/ui/status-chip"
import type { FieldDto } from "./schemas"

/* R1·UP-4c|選項 → 色 tone 解析(單一入口)。

   **安全**(FMEA C1):色設定為使用者可設定之輸入。此處**只回傳受控 tone**,
   由 StatusChip 內部查表映射成 class;呼叫端**永遠不得**把回傳值拼進 className / style。
   查無 / 非法 → `neutral`(後端另有 enum 收斂,兩側皆不接受任意值)。

   🔴 色存在 **choice 物件內**(`choices[].color`),不是外掛的 `colors` side map。
   #105 選項身分模型 v2 把 v1 的 `{choices: string[], colors: Record<名,色>}` 收進
   choice 物件以 stable id 為錨(migration 0027 已轉換既有資料,後端 schema 在寫入時
   吸收並剝除 v1 的 `colors`)—— 故**沒有 v1 資料會再回來,不留相容分支**。
   本函式當時漏改,結果是所有選項章一律 neutral(灰),而型別是 `Record<string, unknown>`
   查不到只會回 undefined,不報錯 → 由 e2e 的 computed color 斷言抓到。 */
export function optionTone(field: FieldDto, value: unknown): ChipTone {
  if (typeof value !== "string") return "neutral"
  const choices = (field.options as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return "neutral"
  for (const c of choices) {
    if (typeof c !== "object" || c === null) continue
    const choice = c as { name?: unknown; color?: unknown }
    if (choice.name === value) return isChipTone(choice.color) ? choice.color : "neutral"
  }
  return "neutral"
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
