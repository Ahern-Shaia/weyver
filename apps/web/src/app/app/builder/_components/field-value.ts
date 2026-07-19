import { isStubType } from "@/lib/engine/field-types"
import type { FieldDto } from "@/lib/engine/schemas"

/* 純值轉換(無 JSX,可單元測):填單 state ↔ 後端型別 */

export function choicesOf(field: FieldDto): string[] {
  const raw = (field.options as { choices?: unknown }).choices
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : []
}

/* 送出前值轉換:回傳 undefined = 略過(不送);money 保字串禁 float,數值轉 number */
export function toSubmitValue(field: FieldDto, value: unknown): unknown {
  if (isStubType(field.type) || field.type === "autoNumber" || field.type === "formula")
    return undefined
  switch (field.type) {
    case "checkbox":
      return value === true
    case "multiSelect":
      return Array.isArray(value) && value.length > 0 ? value : undefined
    case "number":
    case "percent":
    case "rating": {
      if (typeof value !== "string" || value.trim() === "") return undefined
      const n = Number(value)
      return Number.isFinite(n) ? n : value // 非數字原樣送,交後端 422
    }
    case "money":
      return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
    case "dateTime": {
      if (typeof value !== "string" || value === "") return undefined
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? value : d.toISOString()
    }
    default: {
      if (typeof value !== "string") return undefined
      const trimmed = value.trim()
      return trimmed === "" ? undefined : trimmed
    }
  }
}

/* 記錄值顯示(檢視):後端回值 → 可讀字串 */
export function formatFieldValue(field: FieldDto, value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (field.type === "checkbox") return value === true ? "是" : "否"
  if (field.type === "multiSelect" && Array.isArray(value)) return value.join("、")
  if (field.type === "dateTime" && typeof value === "string") {
    return value.replace("T", " ").slice(0, 19)
  }
  return String(value)
}
