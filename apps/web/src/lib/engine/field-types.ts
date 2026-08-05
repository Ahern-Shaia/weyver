import type { CellValueType } from "./schemas"
import { STUB_TYPES } from "./schemas"

/* 前端型別 meta:label / palette 標記 / options 編輯需求。權威在後端 registry;
   此為 UI 呈現用鏡射(型別集合與後端一致,STUB_TYPES 停用不可建)。 */

export interface FieldTypeMeta {
  readonly type: CellValueType
  readonly label: string
  readonly needsChoices: boolean // singleSelect / multiSelect
  readonly needsPrefix: boolean // autoNumber
  readonly needsExpression: boolean // formula
}

const D = { needsChoices: false, needsPrefix: false, needsExpression: false }

const META: Record<CellValueType, Omit<FieldTypeMeta, "type">> = {
  text: { label: "單行文字", ...D },
  longText: { label: "多行文字", ...D },
  email: { label: "Email", ...D },
  url: { label: "網址", ...D },
  phone: { label: "電話", ...D },
  number: { label: "數值", ...D },
  money: { label: "金額", ...D },
  percent: { label: "百分比", ...D },
  date: { label: "日期", ...D },
  dateTime: { label: "日期時間", ...D },
  singleSelect: { label: "單選", ...D, needsChoices: true },
  multiSelect: { label: "多選", ...D, needsChoices: true },
  checkbox: { label: "勾選", ...D },
  rating: { label: "評分", ...D },
  autoNumber: { label: "自動編號", ...D, needsPrefix: true },
  member: { label: "人員", ...D },
  group: { label: "群組", ...D },
  link: { label: "關聯", ...D },
  attachment: { label: "附件", ...D },
  image: { label: "圖片", ...D },
  signature: { label: "簽名", ...D },
  formula: { label: "公式", ...D, needsExpression: true },
  // R1·UP-4 讀時計算 virtual(唯讀)+ 條碼
  createdAt: { label: "建立時間", ...D },
  createdBy: { label: "建立者", ...D },
  updatedAt: { label: "更新時間", ...D },
  updatedBy: { label: "更新者", ...D },
  lookup: { label: "帶入", ...D },
  rollup: { label: "彙總", ...D },
  barcode: { label: "條碼", ...D },
}

/* 進階型別:需設計器另行設定(target/公式/聚合/授權)才能建 → 不入簡易 palette。
   member 在此而非 BUILDABLE:它牽動存取權(#96 指派即授權),不該與一般欄位並列隨手加;
   且 Excel 匯入建表無從把人名對回 actor id。 */
export const ADVANCED_TYPES: readonly CellValueType[] = [
  /* link 由設計器的進階設定建(需指定 targetFormId),不進基本 palette */
  "link",
  "member",
  /* group 與 member 同列進階:它同樣指向系統主體(角色),
     Excel 匯入建表也無從把群組名對回 id */
  "group",
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
