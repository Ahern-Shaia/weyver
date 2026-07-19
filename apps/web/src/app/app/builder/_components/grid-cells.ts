import { isStubType } from "@/lib/engine/field-types"
import type { CellValueType, FieldDto } from "@/lib/engine/schemas"

/* 純網格對映(無 Glide import,可單元測):欄位型別 → cell 種類 / 是否可編輯 / 編輯資料表示 */

export type GridKind = "text" | "number" | "boolean"

const NUMBER_TYPES: readonly CellValueType[] = ["number", "percent", "rating"]

export function gridKind(type: CellValueType): GridKind {
  if (type === "checkbox") return "boolean"
  if (NUMBER_TYPES.includes(type)) return "number"
  // money 用 text(保十進位字串精度);date/dateTime/select 亦 text(overlay 編輯器 P1-I)
  return "text"
}

/* 網格內可直接編輯:排除 autoNumber / formula(computed 唯讀)/ stub / multiSelect(複雜編輯延後)*/
export function isGridEditable(field: FieldDto): boolean {
  return (
    !isStubType(field.type) &&
    field.type !== "autoNumber" &&
    field.type !== "formula" &&
    field.type !== "multiSelect"
  )
}

/* 編輯用資料表示(Text/Number cell 的 data;顯示用 formatFieldValue)*/
export function gridEditData(field: FieldDto, value: unknown): string | number | boolean {
  const kind = gridKind(field.type)
  if (kind === "boolean") return value === true
  if (kind === "number") return typeof value === "number" ? value : Number(value ?? 0)
  return value === null || value === undefined ? "" : String(value)
}
