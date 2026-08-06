import { z } from "zod"

/* 引擎 API 回應 schema(邊界雙向驗證,防 shape drift;鏡射 apps/api api-schemas DTO) */

export const CELL_VALUE_TYPES = [
  "text",
  "longText",
  "markdown",
  "textMask",
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
  "group",
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
/* 🔴 R1·LNK M1(2026-08-04):`link` **已移出 stub**。

   在此之前這裡是 `["link"]`,填單畫面顯示「(此型別即將推出,暫不可填)」——
   而 `formula-and-linkland` 的檔頭同時寫著「Link&Load SHIPPED」。
   **UI 一直說實話,是模組文件在過度宣稱**(見 `_audit/giants-shoulders-audit-C.md` §2.2)。

   現在候選記錄端點與選記錄 UI 都有了,故解除。
   ⚠️ 清單保留(不刪常數)—— 下一個「後端先行、前端未跟上」的型別還會用到它,
   而它的價值正是**讓畫面誠實**:寧可說「還不能填」,也不要給一個填了沒反應的框。 */
export const STUB_TYPES: readonly CellValueType[] = []

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

/* 🔴 與後端 `layout-specs.ts` 的 `FORMAT_OPERATORS` 對映。**不與 `FILTER_OPERATORS` 共用**
   —— 那一份會編成 SQL WHERE,把 `between` / 群組運算子加進去會漏進查詢路徑,
   而那裡沒有實作,結果是無聲的無效條件。 */
export const FORMAT_OPERATORS = [
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
  "between",
  "dailyBetween",
  "inAnyGroup",
  "notInAnyGroup",
  "inAllGroups",
  "notInAllGroups",
] as const

export type FormatOperator = (typeof FORMAT_OPERATORS)[number]

export const formatConditionSchema = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(FORMAT_OPERATORS),
  value: z.unknown().optional(),
})

/* 🔴 OQ-CF-8 = 選項 C-1(2026-08-03):效果升為判別式聯集。
   權威在後端 `layout-specs.ts`,此為鏡射 —— 兩邊要一起改(這份鏡射
   在稽核時被發現**沒有 `.strict()`**,未知欄位會被靜默剝除)。 */
export const formatEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("color"), tone: z.enum(FORMAT_TONES) }),
  /* C-2:純呈現效果,與已出貨的靜態 hidden / readonly 同級(皆前端生效)。
     隱藏不是權限 —— 欄位級保護走 E-1。 */
  z.object({ kind: z.literal("hide") }),
  z.object({ kind: z.literal("readonly") }),
  /* C-2 後半|顯示訊息 —— **規則層效果,不落在欄位上**。
     文字可含 `{{fieldValue:欄名}}` / `{{fieldName:欄名}}`(見 `renderMessage`)。 */
  z.object({ kind: z.literal("message"), text: z.string().min(1).max(500) }),
  /* C-3|條件式必填 —— 伺服器強制(求值器共用 `@weyver/rules`) */
  z.object({ kind: z.literal("required") }),
])
export type FormatEffect = z.infer<typeof formatEffectSchema>

export const formatRuleSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  conditions: z.array(formatConditionSchema).min(1).max(20),
  targets: z.array(z.string().min(1).max(100)).max(50).default([]),
  /* C-2 後半|分段為**目標選擇器**(OQ-CF-9):求值時展開成該列區間內的欄位,與 targets 併集 */
  targetSections: z.array(z.string().min(1).max(60)).max(20).default([]),
  /* C-3|動作按鈕(以 id 指涉)與「開始簽核」按鈕 */
  targetButtons: z.array(z.number().int().positive()).max(50).default([]),
  targetApproval: z.boolean().default(false),
  effects: z.array(formatEffectSchema).min(1).max(10),
  note: z.string().max(200).optional(),
  enabled: z.boolean().default(true),
})
export type FormatRule = z.infer<typeof formatRuleSchema>

/* 相容讀取器,與後端同構:舊 `{ …, tone }` 升級為 `{ effects: [{ kind:"color", tone }] }` */
const formatRuleInputSchema = z.preprocess((raw) => {
  if (typeof raw !== "object" || raw === null) return raw
  const o = raw as Record<string, unknown>
  if (o.effects !== undefined || o.tone === undefined) return raw
  const { tone, ...rest } = o
  return { ...rest, effects: [{ kind: "color", tone }] }
}, formatRuleSchema)

export const conditionalFormatsSchema = z.object({
  record: z.array(formatRuleInputSchema).max(20).default([]),
  list: z.array(formatRuleInputSchema).max(20).default([]),
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
  /* 凍結欄數(從左邊算起)。⚠️ **後端的 `viewConfigSchema` 也要有這一鍵** ——
     它是 non-strict zod,未知鍵靜默 strip,只加前端等於什麼都沒加
     (`groupBy` 就是這樣掉了一次)。上限與後端同為 5。 */
  freezeColumns: z.number().int().min(0).max(5).default(0),
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

/* R1·C-4 事件觸發器。動作是按鈕的**子集** —— `openUrl` 不在,沒有人在場。 */
export const triggerConfigSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("updateSelf"),
    setFields: z.record(z.string(), valueSourceSchema),
  }),
  z.object({
    actionType: z.literal("pushTo"),
    targetFormId: z.number().int(),
    fieldMap: z.record(z.string(), valueSourceSchema),
  }),
])
export type TriggerConfig = z.infer<typeof triggerConfigSchema>

export const triggerDtoSchema = z.object({
  id: z.number().int(),
  formId: z.number().int(),
  name: z.string(),
  onCreate: z.boolean(),
  onUpdate: z.boolean(),
  watchFields: z.array(z.string()),
  conditions: z.array(z.object({ field: z.string(), op: z.string(), value: z.unknown() })),
  actionType: z.enum(["updateSelf", "pushTo"]),
  config: triggerConfigSchema,
  position: z.number().int(),
  enabled: z.boolean(),
  /* 編輯中的版本。上面的 config / conditions 是**正在跑的**那一版。 */
  draft: z.object({
    onCreate: z.boolean(),
    onUpdate: z.boolean(),
    watchFields: z.array(z.string()),
    conditions: z.array(z.object({ field: z.string(), op: z.string(), value: z.unknown() })),
    actionType: z.enum(["updateSelf", "pushTo"]),
    config: triggerConfigSchema,
  }),
  isPublished: z.boolean(),
  hasUnpublishedChanges: z.boolean(),
})
export type TriggerDto = z.infer<typeof triggerDtoSchema>

export const triggerRunDtoSchema = z.object({
  id: z.number().int(),
  triggerId: z.number().int(),
  triggerName: z.string(),
  recordId: z.number().int(),
  outcome: z.enum(["ran", "skipped", "denied", "failed", "depth"]),
  detail: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
})
export type TriggerRunDto = z.infer<typeof triggerRunDtoSchema>

export const triggerDryRunSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  ran: z.array(z.object({ triggerId: z.number().int() })),
})

export const actionResultSchema = z.object({
  outcome: z.enum(["updated", "created", "openUrl", "duplicate"]),
  targetRecordId: z.number().int().optional(),
  url: z.string().optional(),
})
export type ActionResult = z.infer<typeof actionResultSchema>

/* 對齊後端 `action-specs.ts`。**`approverRoleId` 是選配的** ——
   動態關卡(送直屬主管)沒有靜態角色可指定;宣告成必填的話,
   一收到動態關卡 zod 就整個 parse 失敗,而症狀會是「簽核區塊整塊不見」。 */
export const APPROVER_RULES = [
  "role",
  "manager",
  "managerOfManager",
  "managerOfPrevApprover",
  /* 🔴 2026-08-04:這一項後端 2026-08-03 就出貨了,前端鏡射**沒跟上**。
     後果比「選不到」更糟:`z.enum` 解不到 `fieldRef` → 整個 def 解析失敗,
     而症狀是**簽核區塊整塊不見**(同一個檔案上面那段註解正好警告過這件事)。
     也就是說,用 API 建了 fieldRef 流程的租戶,會發現簽核設定畫面空了。 */
  "fieldRef",
] as const

export const approvalStepSchema = z.object({
  stepNo: z.number().int(),
  approverRoleId: z.number().int().optional(),
  approverRule: z.enum(APPROVER_RULES).default("role"),
  /* `fieldRef` 專用:member 欄位的顯示名 */
  approverField: z.string().optional(),
  /* 未填 = 任一人;數字 = 擇辦 N 人;"all" = 會簽全體 */
  quorum: z.union([z.number().int(), z.literal("all")]).optional(),
  returnableTo: z.array(z.number().int()).optional(),
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
  unlockedAt: z.string().nullable(),
  /* 會簽進度由後端算(見 approval.service.stepProgress)—— 前端自己從 log 推導
     就要重現「只算最後一次退回之後的核准」那條規則,那是兩份實作 */
  stepProgress: z.object({ approved: z.number().int(), required: z.number().int() }),
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

/* G-1 整合(webhook / API 金鑰) */
export const webhookEndpointSchema = z.object({
  id: z.number(),
  url: z.string(),
  description: z.string().nullable(),
  eventTypes: z.array(z.string()),
  verified: z.boolean(),
  disabledAt: z.string().nullable(),
  disabledReason: z.string().nullable(),
  createdAt: z.string(),
})
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>

export const webhookDeliverySchema = z.object({
  id: z.number(),
  messageId: z.string(),
  eventType: z.string(),
  status: z.string(),
  attempts: z.number(),
  responseCode: z.number().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
})
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>

export const apiKeySchema = z.object({
  id: z.number(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
})
export type ApiKeyView = z.infer<typeof apiKeySchema>

/* G-2 公開表單 */
export const publicShareSchema = z.object({
  id: z.number(),
  formId: z.number(),
  title: z.string(),
  fieldIds: z.array(z.number()),
  active: z.boolean(),
  closesAt: z.string().nullable(),
  maxSubmissions: z.number().nullable(),
  submissionCount: z.number(),
  createdAt: z.string(),
})
export type PublicShare = z.infer<typeof publicShareSchema>

export const publicSubmissionSchema = z.object({
  id: z.number(),
  shareId: z.number(),
  formId: z.number(),
  values: z.record(z.string(), z.unknown()),
  status: z.string(),
  createdAt: z.string(),
})
export type PublicSubmission = z.infer<typeof publicSubmissionSchema>
