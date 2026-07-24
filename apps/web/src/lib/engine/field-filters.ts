import type { CellValueType, FilterOperator } from "./schemas"

/* R1·UP-2 前端 operator 對映(鏡射後端 field-type-registry.filterOperators;權威驗證仍在後端)。 */

const EMPTINESS: FilterOperator[] = ["isEmpty", "isNotEmpty"]
const EQUALITY: FilterOperator[] = ["eq", "neq", ...EMPTINESS]
const ORDERED: FilterOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte", ...EMPTINESS]
const TEXTUAL: FilterOperator[] = ["eq", "neq", "contains", ...EMPTINESS]

export function fieldOperators(type: CellValueType): FilterOperator[] {
  switch (type) {
    case "text":
    case "longText":
    case "email":
    case "url":
    case "phone":
      return TEXTUAL
    // autoNumber 為 systemManaged(valueSchema=never)→ eq/neq 後端解析必敗;僅 contains/空值可用
    case "autoNumber":
      return ["contains", ...EMPTINESS]
    case "number":
    case "money":
    case "percent":
    case "date":
    case "dateTime":
    case "rating":
    case "formula":
      return ORDERED
    case "singleSelect":
      return ["eq", "neq", "anyOf", ...EMPTINESS]
    case "multiSelect":
      return ["anyOf", ...EMPTINESS]
    case "checkbox":
    case "member":
    case "link":
      return EQUALITY
    case "attachment":
      return EMPTINESS
  }
}

export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  eq: "等於",
  neq: "不等於",
  contains: "包含",
  gt: "大於",
  gte: "≥",
  lt: "小於",
  lte: "≤",
  anyOf: "屬於任一",
  isEmpty: "為空",
  isNotEmpty: "不為空",
}

/* isEmpty / isNotEmpty 不需值 */
export function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== "isEmpty" && op !== "isNotEmpty"
}
