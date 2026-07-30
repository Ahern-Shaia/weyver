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
  // R1·UP-4b 影像類欄型(與 attachment 同 [{key,name}] 契約)
  "image",
  "signature",
  "formula",
  // R1·UP-4 讀時計算 virtual + 條碼(鏡射後端 registry)
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "lookup",
  "rollup",
  "barcode",
] as const

export type CellValueType = (typeof CELL_VALUE_TYPES)[number]

/* stub 型別(引擎 systemManaged / 行為未實作)→ palette 停用、填單唯讀。
   attachment 已於 F-5 file-storage 解鎖(上傳/下載/移除)→ 移出本清單。 */
export const STUB_TYPES: readonly CellValueType[] = ["link"]

/* F-5 附件:欄值契約 [{key,name}](後端 attachment valueSchema,max 50) */
export const attachmentItemSchema = z.object({ key: z.string(), name: z.string() })
export type AttachmentItem = z.infer<typeof attachmentItemSchema>

/* R1·workbench-uplift A5:actor id → 顯示名(稽核區用;後端只回 {id,name})*/
export const userNameSchema = z.object({ id: z.number().int(), name: z.string() })
export type UserName = z.infer<typeof userNameSchema>

/* A3 反向關聯:本筆被哪些記錄引用 */
export const reverseRelationGroupSchema = z.object({
  formId: z.number().int(),
  formName: z.string(),
  viaFieldName: z.string(),
  records: z.array(z.object({ id: z.number().int(), title: z.string() })),
  truncated: z.boolean(),
})
export type ReverseRelationGroup = z.infer<typeof reverseRelationGroupSchema>

export const fileDtoSchema = z.object({
  key: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
})

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
  /* 不透明續頁權杖(#95)—— 原樣傳回即可,不得自行解讀。
     原本是 record id,但依非 id 欄排序時會整頁跳過。 */
  nextCursor: z.string().nullable(),
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

/* R1·UP-3b 條件式格式(鏡射後端 layout-specs;權威驗證仍在後端)*/
export const FORMAT_TONES = [
  "ok",
  "warn",
  "error",
  "neutral",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "c7",
  "c8",
] as const

export const formatConditionSchema = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(FILTER_OPERATORS),
  value: z.unknown().optional(),
})

export const formatRuleSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  conditions: z.array(formatConditionSchema).min(1).max(20),
  targets: z.array(z.string().min(1).max(100)).max(50).default([]),
  tone: z.enum(FORMAT_TONES),
})
export type FormatRule = z.infer<typeof formatRuleSchema>

export const conditionalFormatsSchema = z.object({
  record: z.array(formatRuleSchema).max(20).default([]),
  list: z.array(formatRuleSchema).max(20).default([]),
})
export type ConditionalFormats = z.infer<typeof conditionalFormatsSchema>

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

/* F-1 分組:分組鍵前置於排序鍵(≤3 層)。日期欄可指定粒度。 */
export const GROUP_DATE_UNITS = ["day", "month", "quarter", "year"] as const
export const viewGroupSchema = z.object({
  field: z.string(),
  dir: z.enum(["asc", "desc"]).default("asc"),
  unit: z.enum(GROUP_DATE_UNITS).optional(),
})
export type ViewGroup = z.infer<typeof viewGroupSchema>

export const GROUP_AGGREGATE_FNS = ["count", "empty", "filled", "sum", "avg", "min", "max"] as const
export type GroupAggregateFn = (typeof GROUP_AGGREGATE_FNS)[number]

export const viewConfigSchema = z.object({
  fields: z.array(z.string()).default([]),
  filter: z
    .object({
      combinator: z.enum(["and", "or"]).default("and"),
      conditions: z.array(viewFilterConditionSchema).default([]),
    })
    .default({ combinator: "and", conditions: [] }),
  sorts: z.array(viewSortSchema).default([]),
  groupBy: z.array(viewGroupSchema).max(3).default([]),
  /* 群組小計:{欄位, 函數} 列表。空 = 只顯示筆數。 */
  aggregates: z
    .array(z.object({ field: z.string(), fn: z.enum(GROUP_AGGREGATE_FNS) }))
    .max(10)
    .default([]),
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

/* R1·UP-3 2D 設計器版面 metadata(form_def.layout;鏡射後端 layout-specs)。 */
export const DEFAULT_VARIABLES = [
  "$DATE",
  "$TIME",
  "$DATETIME",
  "$YEAR",
  "$MONTH",
  "$WEEKDAY",
  "$USERID",
  "$USERNAME",
] as const
export type DefaultVariable = (typeof DEFAULT_VARIABLES)[number]

export const defaultValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.string() }),
  z.object({ kind: z.literal("variable"), value: z.enum(DEFAULT_VARIABLES) }),
  z.object({ kind: z.literal("formula"), value: z.string() }),
])
export type DefaultValue = z.infer<typeof defaultValueSchema>

const layoutStyleSchema = z
  .object({
    font: z.string().optional(),
    size: z.number().int().optional(),
    color: z.string().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    bg: z.string().optional(),
  })
  .partial()

export const fieldLayoutSchema = z.object({
  row: z.number().int(),
  col: z.number().int(),
  colSpan: z.number().int().optional(),
  sectionId: z.string().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  readonly: z.boolean().optional(),
  hidden: z.boolean().optional(),
  defaultValue: defaultValueSchema.optional(),
})
export type FieldLayout = z.infer<typeof fieldLayoutSchema>

export const staticElementSchema = z.object({
  id: z.string(),
  kind: z.enum(["text", "image"]),
  row: z.number().int(),
  col: z.number().int(),
  colSpan: z.number().int().optional(),
  text: z.string().optional(),
  markdown: z.boolean().optional(),
  href: z.string().optional(),
  imageUrl: z.string().optional(),
  designOnly: z.boolean().optional(),
  style: layoutStyleSchema.optional(),
})
export type StaticElement = z.infer<typeof staticElementSchema>

export const sectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  fromRow: z.number().int(),
  toRow: z.number().int(),
  style: layoutStyleSchema.optional(),
})
export type Section = z.infer<typeof sectionSchema>

/* R1·後續-2 列印設定(列範圍;紙張/邊界/方向委派瀏覽器,OQ-PM-3/6) */
export const layoutPrintSchema = z.object({
  headerRows: z.array(z.number().int()),
  footerRows: z.array(z.number().int()),
  pageBreakAfterRows: z.array(z.number().int()),
})
export type LayoutPrint = z.infer<typeof layoutPrintSchema>

export const layoutSchema = z.object({
  grid: z.object({
    cols: z.number().int(),
    rowHeights: z.record(z.string(), z.number()).optional(),
    colWidths: z.record(z.string(), z.number()).optional(),
  }),
  fields: z.record(z.string(), fieldLayoutSchema),
  statics: z.array(staticElementSchema),
  sections: z.array(sectionSchema),
  print: layoutPrintSchema.optional(),
  conditionalFormats: conditionalFormatsSchema.optional(),
})
export type Layout = z.infer<typeof layoutSchema>

/* R1·後續-1 自訂按鈕 + 簽核(鏡射後端 action-specs) */
export const valueSourceSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("literal"), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ from: z.literal("field"), field: z.string() }),
  z.object({ from: z.literal("variable"), variable: z.enum(["$NOW", "$TODAY", "$USERID"]) }),
])
export type ValueSource = z.infer<typeof valueSourceSchema>

export const buttonConfigSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("updateSelf"),
    setFields: z.record(z.string(), valueSourceSchema),
  }),
  z.object({
    actionType: z.literal("pushTo"),
    targetFormId: z.number().int(),
    fieldMap: z.record(z.string(), valueSourceSchema),
  }),
  z.object({ actionType: z.literal("openUrl"), url: z.string() }),
])
export type ButtonConfig = z.infer<typeof buttonConfigSchema>

export const buttonDtoSchema = z.object({
  id: z.number().int(),
  formId: z.number().int(),
  label: z.string(),
  actionType: z.enum(["updateSelf", "pushTo", "openUrl"]),
  config: buttonConfigSchema,
  confirm: z.boolean(),
  position: z.number().int(),
})
export type ButtonDto = z.infer<typeof buttonDtoSchema>

export const actionResultSchema = z.object({
  outcome: z.enum(["updated", "created", "openUrl", "duplicate"]),
  targetRecordId: z.number().int().optional(),
  url: z.string().optional(),
})
export type ActionResult = z.infer<typeof actionResultSchema>

export const approvalStepSchema = z.object({
  stepNo: z.number().int(),
  approverRoleId: z.number().int(),
  amountField: z.string().optional(),
  minAmount: z.number().optional(),
})
export type ApprovalStep = z.infer<typeof approvalStepSchema>

export const approvalDefDtoSchema = z.object({
  id: z.number().int(),
  formId: z.number().int(),
  name: z.string(),
  steps: z.array(approvalStepSchema),
  onCompleteButtonId: z.number().int().nullable(),
  active: z.boolean(),
})
export type ApprovalDefDto = z.infer<typeof approvalDefDtoSchema>

export const approvalInstanceDtoSchema = z.object({
  id: z.number().int(),
  defId: z.number().int(),
  formId: z.number().int(),
  recordId: z.number().int(),
  currentStep: z.number().int(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
  submittedBy: z.number().int(),
  updatedAt: z.string(),
  steps: z.array(approvalStepSchema),
  log: z.array(
    z.object({
      stepNo: z.number().int(),
      actorId: z.number().int(),
      decision: z.string(),
      comment: z.string().nullable(),
      at: z.string(),
    }),
  ),
})
export type ApprovalInstanceDto = z.infer<typeof approvalInstanceDtoSchema>

/* R1·後續-2 標籤定義(鏡射後端 label-specs) */
export const labelItemSchema = z.object({
  field: z.string(),
  asQr: z.boolean().optional(),
  style: z
    .object({
      size: z.number().int().optional(),
      align: z.enum(["left", "center", "right"]).optional(),
      bold: z.boolean().optional(),
      wrap: z.boolean().optional(),
    })
    .optional(),
})
export type LabelItem = z.infer<typeof labelItemSchema>

export const labelConfigSchema = z.object({
  size: z.object({ widthMm: z.number(), heightMm: z.number() }),
  tile: z.boolean(),
  gapMm: z.number(),
  showFieldNames: z.boolean(),
  copiesField: z.string().optional(),
  items: z.array(labelItemSchema),
})
export type LabelConfig = z.infer<typeof labelConfigSchema>

export const labelDtoSchema = z.object({
  id: z.number().int(),
  formId: z.number().int(),
  name: z.string(),
  config: labelConfigSchema,
  position: z.number().int(),
})
export type LabelDto = z.infer<typeof labelDtoSchema>

export const MAX_LABELS_PER_RUN = 1000
export const MAX_COPIES_PER_RECORD = 99

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

/* H-1 通知(docs/modules/R1/notifications.md)。
   **回應刻意不含欄位值**(OQ-NT-9):欄位級權限使業界主流的「過濾收件人」失效,
   故通知只帶表單名 + 事件 + 記錄編號,點進去才做權限檢查。 */
export const notificationItemSchema = z.object({
  id: z.number(),
  event: z.string(),
  formId: z.number().nullable(),
  recordId: z.number().nullable(),
  title: z.string(),
  actorId: z.number().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
})
export type NotificationItem = z.infer<typeof notificationItemSchema>

export const notificationListSchema = z.object({
  unread: z.number(),
  items: z.array(notificationItemSchema),
})

export const notificationPrefSchema = z.object({
  scope: z.enum(["tenant", "category", "form"]),
  scopeId: z.number().nullable(),
  level: z.number(),
  customEvents: z.array(z.string()).nullable(),
})
export type NotificationPref = z.infer<typeof notificationPrefSchema>

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  channels: z.record(z.string(), z.array(z.string())).nullable(),
  prefs: z.array(notificationPrefSchema),
})
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>

/* H-2 回收桶 */
export const trashItemSchema = z.object({
  id: z.number(),
  resourceType: z.enum(["record", "form", "field"]),
  resourceId: z.number(),
  formId: z.number().nullable(),
  title: z.string(),
  formName: z.string().nullable(),
  deletedBy: z.number().nullable(),
  deletedAt: z.string(),
  purgeAfter: z.string(),
})
export type TrashItem = z.infer<typeof trashItemSchema>

export const restoreBlockerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("parentDeleted"), message: z.string() }),
  z.object({ kind: z.literal("nameConflict"), message: z.string(), conflictName: z.string() }),
  z.object({
    kind: z.literal("constraintViolation"),
    message: z.string(),
    fields: z.array(z.string()),
  }),
])
export type RestoreBlocker = z.infer<typeof restoreBlockerSchema>
