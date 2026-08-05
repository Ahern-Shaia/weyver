import type { CellValueType, FilterOperator, FormatOperator } from "./schemas"

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
    case "barcode":
      return TEXTUAL
    case "attachment":
    case "image":
    case "signature":
      return EMPTINESS
    // R1·UP-4 讀時計算虛擬欄:無物理欄 → 不可篩(比照後端 filterOperators [])
    case "createdAt":
    case "createdBy":
    case "updatedAt":
    case "updatedBy":
    case "lookup":
    case "rollup":
      return []
  }
}

/* 🔴 條件式格式的運算子標籤。**與篩選那一份分開** ——
   `OPERATOR_LABEL` 對映的是會編成 SQL 的 `FilterOperator`,
   而條件式格式多出來的幾個(區間 / 每日時間 / 群組)在 SQL 那條路上沒有實作。 */
export const FORMAT_OPERATOR_LABEL: Record<FormatOperator, string> = {
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
  between: "介於",
  dailyBetween: "每日時段內",
  inAnyGroup: "屬於其中任一群組",
  notInAnyGroup: "不屬於其中任何群組",
  inAllGroups: "屬於所有指定群組",
  notInAllGroups: "不屬於所有指定群組",
}

/* 條件式格式的「條件欄位」除了記錄上的欄位,還有兩個虛擬欄位。
   Ragic `doc/6` 逐字:「你也可以針對**當前時間**設定指定日期、時間或區間」、
   「另外也可以針對**登入使用者**設定特定使用者或是群組為指定條件」。 */
export const PSEUDO_FIELD_LABEL: Record<string, string> = {
  $now: "當前時間",
  $actor: "登入使用者",
}

export function formatOperatorsFor(
  field: string,
  type: CellValueType | undefined,
): FormatOperator[] {
  if (field === "$now") return ["between", "dailyBetween", "gt", "gte", "lt", "lte", "eq"]
  if (field === "$actor")
    return ["anyOf", "inAnyGroup", "notInAnyGroup", "inAllGroups", "notInAllGroups"]
  const base = type === undefined ? [] : (fieldOperators(type) as FormatOperator[])
  /* 日期類多給「介於」——「這張單在 3/1 到 3/5 之間」是實際會用的條件 */
  return type === "date" || type === "dateTime" ? [...base, "between"] : base
}

/* 需要兩個值(區間)的運算子 */
export function operatorNeedsRange(op: string): boolean {
  return op === "between" || op === "dailyBetween"
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
