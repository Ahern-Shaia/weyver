import type { CellValueType } from "./schemas"
import { STUB_TYPES } from "./schemas"

/* 前端型別 meta:label / palette 標記 / options 編輯需求。權威在後端 registry;
   此為 UI 呈現用鏡射(型別集合與後端一致,STUB_TYPES 停用不可建)。 */

export interface FieldTypeMeta {
  readonly type: CellValueType
  readonly label: string
  readonly mark: string
  readonly needsChoices: boolean // singleSelect / multiSelect
  readonly needsPrefix: boolean // autoNumber
}

const META: Record<CellValueType, Omit<FieldTypeMeta, "type">> = {
  text: { label: "單行文字", mark: "A", needsChoices: false, needsPrefix: false },
  longText: { label: "多行文字", mark: "¶", needsChoices: false, needsPrefix: false },
  email: { label: "Email", mark: "@", needsChoices: false, needsPrefix: false },
  url: { label: "網址", mark: "↗", needsChoices: false, needsPrefix: false },
  phone: { label: "電話", mark: "☏", needsChoices: false, needsPrefix: false },
  number: { label: "數值", mark: "#", needsChoices: false, needsPrefix: false },
  money: { label: "金額", mark: "$", needsChoices: false, needsPrefix: false },
  percent: { label: "百分比", mark: "%", needsChoices: false, needsPrefix: false },
  date: { label: "日期", mark: "◷", needsChoices: false, needsPrefix: false },
  dateTime: { label: "日期時間", mark: "◷", needsChoices: false, needsPrefix: false },
  singleSelect: { label: "單選", mark: "▾", needsChoices: true, needsPrefix: false },
  multiSelect: { label: "多選", mark: "▤", needsChoices: true, needsPrefix: false },
  checkbox: { label: "勾選", mark: "✓", needsChoices: false, needsPrefix: false },
  rating: { label: "評分", mark: "★", needsChoices: false, needsPrefix: false },
  autoNumber: { label: "自動編號", mark: "№", needsChoices: false, needsPrefix: true },
  member: { label: "成員", mark: "◍", needsChoices: false, needsPrefix: false },
  link: { label: "關聯", mark: "⛓", needsChoices: false, needsPrefix: false },
  attachment: { label: "附件", mark: "📎", needsChoices: false, needsPrefix: false },
  formula: { label: "公式", mark: "fx", needsChoices: false, needsPrefix: false },
}

export function fieldTypeMeta(type: CellValueType): FieldTypeMeta {
  return { type, ...META[type] }
}

/* 可建型別:排除 stub(member/link/attachment/formula 行為未實作)*/
export const BUILDABLE_TYPES: readonly CellValueType[] = (
  Object.keys(META) as CellValueType[]
).filter((t) => !STUB_TYPES.includes(t))

export function isStubType(type: CellValueType): boolean {
  return STUB_TYPES.includes(type)
}

/* 型別轉換白名單(鏡射後端 type-conversions;只列合法目標;非法選項 UI 不出現)*/
const SAFE_CONVERSIONS: Partial<Record<CellValueType, readonly CellValueType[]>> = {
  text: ["longText"],
  email: ["text", "longText"],
  url: ["text", "longText"],
  phone: ["text", "longText"],
  singleSelect: ["text", "longText"],
}

export function conversionTargets(from: CellValueType): readonly CellValueType[] {
  return SAFE_CONVERSIONS[from] ?? []
}
