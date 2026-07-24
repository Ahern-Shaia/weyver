import { z } from "zod"

/* 引擎 API 回應 schema(邊界雙向驗證,防 shape drift;鏡射 apps/api api-schemas DTO) */

export const CELL_VALUE_TYPES = [
  "text",
  "longText",
  "email",
  "url",
  "phone",
  "number",
  "money",
  "percent",
  "date",
  "dateTime",
  "singleSelect",
  "multiSelect",
  "checkbox",
  "rating",
  "autoNumber",
  "member",
  "link",
  "attachment",
  "formula",
] as const

export type CellValueType = (typeof CELL_VALUE_TYPES)[number]

/* stub 型別(引擎 systemManaged / 行為未實作)→ palette 停用、填單唯讀 */
export const STUB_TYPES: readonly CellValueType[] = ["member", "link", "attachment"]

export const fieldDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.enum(CELL_VALUE_TYPES),
  required: z.boolean(),
  unique: z.boolean(),
  options: z.record(z.string(), z.unknown()),
  position: z.number().int(),
})

export type FieldDto = z.infer<typeof fieldDtoSchema>

export const formSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  provisionState: z.enum(["pending", "ready", "failed"]),
  version: z.number().int(),
  parentFormId: z.number().int().nullable(),
  // P0-4a·uplift OQ-8:清單三態之鎖定 stub(非敏感無權)。單筆 GET 不含此欄 → optional
  locked: z.boolean().optional(),
  // R1·UP-1 workspace-ia:目錄用(所屬分類 + 最近更新);單筆 GET 不含 → optional
  categoryId: z.number().int().nullable().optional(),
  updatedAt: z.string().optional(),
})

export type FormSummary = z.infer<typeof formSummarySchema>

export const formDtoSchema = formSummarySchema.extend({
  fields: z.array(fieldDtoSchema),
})

export type FormDto = z.infer<typeof formDtoSchema>

export const recordRowSchema = z.object({
  id: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
  createdBy: z.number().int(),
  updatedAt: z.string(),
  updatedBy: z.number().int(),
  parentId: z.number().int().nullable(),
  lineNo: z.number().int().nullable(),
  values: z.record(z.string(), z.unknown()),
})

export type RecordRow = z.infer<typeof recordRowSchema>

export const listResponseSchema = z.object({
  records: z.array(recordRowSchema),
  nextCursor: z.number().int().nullable(),
})

export type ListResponse = z.infer<typeof listResponseSchema>

/* R1·UP-2 視圖(view_def)。config 欄位以「顯示名」表示,直接對映 records query API。 */
export const FILTER_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "anyOf",
  "isEmpty",
  "isNotEmpty",
] as const
export type FilterOperator = (typeof FILTER_OPERATORS)[number]

export const viewFilterConditionSchema = z.object({
  field: z.string(),
  op: z.enum(FILTER_OPERATORS),
  value: z.unknown().optional(),
})
export type ViewFilterCondition = z.infer<typeof viewFilterConditionSchema>

export const viewSortSchema = z.object({
  field: z.string(),
  dir: z.enum(["asc", "desc"]),
})
export type ViewSort = z.infer<typeof viewSortSchema>

export const viewConfigSchema = z.object({
  fields: z.array(z.string()).default([]),
  filter: z
    .object({
      combinator: z.enum(["and", "or"]).default("and"),
      conditions: z.array(viewFilterConditionSchema).default([]),
    })
    .default({ combinator: "and", conditions: [] }),
  sorts: z.array(viewSortSchema).default([]),
  search: z.string().optional(),
  pageSize: z.number().int().optional(),
})
export type ViewConfig = z.infer<typeof viewConfigSchema>

export const viewDtoSchema = z.object({
  id: z.number().int(),
  formId: z.number().int(),
  name: z.string(),
  scope: z.enum(["personal", "shared"]),
  isDefault: z.boolean(),
  locked: z.boolean(),
  config: viewConfigSchema,
  position: z.number().int(),
  createdBy: z.number().int().nullable(),
  updatedAt: z.string(),
})
export type ViewDto = z.infer<typeof viewDtoSchema>

export const errorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().optional(),
  timestamp: z.string().optional(),
})

/* 送出 spec(鏡射後端 CreateFormSpec / AddFieldSpec 形狀;權威驗證在後端) */
export interface AddFieldInput {
  readonly name: string
  readonly type: CellValueType
  readonly required?: boolean
  readonly options?: Record<string, unknown>
}

export interface CreateFormInput {
  readonly name: string
  readonly parentFormId?: number
  readonly fields: readonly AddFieldInput[]
}
