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
  readonly needsExpression: boolean // formula
}

const D = { needsChoices: false, needsPrefix: false, needsExpression: false }

const META: Record<CellValueType, Omit<FieldTypeMeta, "type">> = {
  text: { label: "單行文字", mark: "A", ...D },
  longText: { label: "多行文字", mark: "¶", ...D },
  email: { label: "Email", mark: "@", ...D },
  url: { label: "網址", mark: "↗", ...D },
  phone: { label: "電話", mark: "☏", ...D },
  number: { label: "數值", mark: "#", ...D },
  money: { label: "金額", mark: "$", ...D },
  percent: { label: "百分比", mark: "%", ...D },
  date: { label: "日期", mark: "◷", ...D },
  dateTime: { label: "日期時間", mark: "◷", ...D },
  singleSelect: { label: "單選", mark: "▾", ...D, needsChoices: true },
  multiSelect: { label: "多選", mark: "▤", ...D, needsChoices: true },
  checkbox: { label: "勾選", mark: "✓", ...D },
  rating: { label: "評分", mark: "★", ...D },
  autoNumber: { label: "自動編號", mark: "№", ...D, needsPrefix: true },
  member: { label: "成員", mark: "◍", ...D },
  link: { label: "關聯", mark: "⛓", ...D },
  attachment: { label: "附件", mark: "📎", ...D },
  formula: { label: "公式", mark: "fx", ...D, needsExpression: true },
  // R1·UP-4 讀時計算 virtual(唯讀)+ 條碼
  createdAt: { label: "建立時間", mark: "◷", ...D },
  createdBy: { label: "建立者", mark: "◍", ...D },
  updatedAt: { label: "更新時間", mark: "◷", ...D },
  updatedBy: { label: "更新者", mark: "◍", ...D },
  lookup: { label: "帶入", mark: "⇒", ...D },
  rollup: { label: "彙總", mark: "Σ", ...D },
  barcode: { label: "條碼", mark: "▐", ...D },
}

/* 進階型別:需 M4 設計器設定(target/公式/聚合)才能建 → 不入簡易 palette */
export const ADVANCED_TYPES: readonly CellValueType[] = [
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "lookup",
  "rollup",
]

export function fieldTypeMeta(type: CellValueType): FieldTypeMeta {
  return { type, ...META[type] }
}

/* 可建型別:排除 stub + 進階型別(進階由 M4 設計器設定建)*/
export const BUILDABLE_TYPES: readonly CellValueType[] = (
  Object.keys(META) as CellValueType[]
).filter((t) => !STUB_TYPES.includes(t) && !ADVANCED_TYPES.includes(t))

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
