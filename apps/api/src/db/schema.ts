import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

/* metadata catalog(固定 schema,Drizzle 車道;Tier-2 動態表走 Knex 車道,永不進此檔) */

export const tenants = pgTable("tenants", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  name: text("name").notNull(),
  // F-2 M2:Better Auth organization.id ↔ tenant(nullable = dev/種子租戶未綁 org;unique 一 org 一 tenant)
  authOrgId: text("auth_org_id").unique(),
  // 便宜預留巢狀租戶 / 代管母子(AUTH-8 場景 B);MVP 不實作跨租戶讀取,只留欄位
  parentTenantId: bigint("parent_tenant_id", { mode: "number" }).references(
    (): AnyPgColumn => tenants.id,
  ),
  // P0-4a·uplift 資源軸繼承:未分類且無授權之非敏感表 baseline(Salesforce OWD 式;空=deny,admin 可設 view)
  defaultFormActions: text("default_form_actions").array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/* F-2 M2:Weyver 使用者身分(Tier-1 系統表,跨租戶、非 RLS 範疇)。
   auth_user_id ↔ Better Auth user.id;actorId(= users.id bigint)為 created_by/updated_by 之來源(OQ-AUTH-4)。
   首次登入 / 加入 org → upsert(idempotent);軟刪(deleted_at)不影響歷史 created_by。 */
export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  authUserId: text("auth_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
})

export const formDefs = pgTable(
  "form_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    // OQ-FEC-1 = A:物理名由 DB 生成欄保證與 id 一致,app 端不可寫
    physicalTable: text("physical_table").notNull().generatedAlwaysAs(sql`'t' || id`),
    provisionState: text("provision_state").notNull().default("pending"),
    parentFormId: bigint("parent_form_id", { mode: "number" }).references(
      (): AnyPgColumn => formDefs.id,
    ),
    // P0-4a·uplift 資源軸繼承:所屬分類(NULL=未分類)。分類刪除 → SET NULL(表回退未分類,不孤兒)
    categoryId: bigint("category_id", { mode: "number" }).references(
      (): AnyPgColumn => formCategories.id,
      { onDelete: "set null" },
    ),
    // 敏感表:不吃分類繼承/預設,只認 owner + 明確覆寫(OQ-ARI-5)
    isSensitive: boolean("is_sensitive").notNull().default(false),
    // R1·UP-3 2D 設計器:整表版面 metadata(座標/設定/靜態/分段;與資料正交,null=預設投影,OQ-FD2-1)
    layout: jsonb("layout"),
    // 建立者:owner 短路(得資料動作、design 除外,OQ-ARI-4=B)。既有表遷移為 NULL(無 owner)
    createdBy: bigint("created_by", { mode: "number" }).references((): AnyPgColumn => users.id),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("form_def_tenant_name_uq").on(t.tenantId, t.name).where(sql`deleted_at IS NULL`),
    index("form_def_tenant_idx").on(t.tenantId),
  ],
)

export const fieldDefs = pgTable(
  "field_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references(() => formDefs.id),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    physicalColumn: text("physical_column").notNull().generatedAlwaysAs(sql`'f' || id`),
    cellValueType: text("cell_value_type").notNull(),
    dbFieldType: text("db_field_type").notNull(),
    options: jsonb("options").notNull().default({}),
    required: boolean("required").notNull().default(false),
    isUnique: boolean("is_unique").notNull().default(false),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("field_def_form_name_uq").on(t.formId, t.name).where(sql`deleted_at IS NULL`),
    index("field_def_form_idx").on(t.formId),
  ],
)

/* DDL 全程 audit(who / spec / sql / result;docs/22) */
export const ddlAudits = pgTable(
  "ddl_audit",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }),
    action: text("action").notNull(),
    spec: jsonb("spec").notNull().default({}),
    executedSql: text("executed_sql"),
    result: text("result").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ddl_audit_tenant_idx").on(t.tenantId, t.createdAt)],
)

/* P0-3 Link&Load 用;本模組只建結構(stub) */
export const relationDefs = pgTable(
  "relation_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references(() => formDefs.id),
    fieldId: bigint("field_id", { mode: "number" })
      .notNull()
      .references(() => fieldDefs.id),
    targetFormId: bigint("target_form_id", { mode: "number" })
      .notNull()
      .references(() => formDefs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("relation_def_form_idx").on(t.formId)],
)

/* P0-3 公式:每公式欄一列;depends_on = 依賴的 field_def id 陣列(名稱於定義期解析成 id,穩定於改名)。
   本模組(M1)只建結構 + defineFormula 驗證/解析/存;依賴圖重算為 M2。 */
export const formulaDefs = pgTable(
  "formula_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references(() => formDefs.id),
    fieldId: bigint("field_id", { mode: "number" })
      .notNull()
      .references(() => fieldDefs.id),
    exprSource: text("expr_source").notNull(),
    resultType: text("result_type").notNull(),
    dependsOn: jsonb("depends_on").notNull().default([]),
    materialized: boolean("materialized").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("formula_def_field_uq").on(t.fieldId),
    index("formula_def_form_idx").on(t.formId),
  ],
)

/* P0-4a authz(Tier-1 系統表,租戶內授權;非 RLS,以 tenant_id 欄 + app 層 scope,由特權 DRIZZLE 車道讀寫)。
   授權只能收窄同租戶可見範圍,永不放寬跨租戶(RLS 仍為最後防線)。docs/modules/R1/authz.md。 */

/* 角色 / 部門樹(OQ-1=C:parent_id 樹狀;權限沿樹向下繼承,有效權限=自身角色 ∪ 祖先) */
export const roles = pgTable(
  "roles",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    // NULL = 根;RESTRICT:有子節點不得刪(避免孤兒)。同租戶 parent 由 app 層驗(§5.1)
    parentId: bigint("parent_id", { mode: "number" }).references((): AnyPgColumn => roles.id, {
      onDelete: "restrict",
    }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    depth: smallint("depth").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roles_tenant_key_uq").on(t.tenantId, t.key),
    index("roles_tenant_idx").on(t.tenantId),
    index("roles_parent_idx").on(t.parentId),
    // 禁自我 parent;跨層 cycle 由 app 層防(recursive CTE visited set,§5.1)
    check("roles_no_self_parent", sql`parent_id IS NULL OR parent_id <> id`),
  ],
)

/* 使用者 ↔ 角色(多對多;有效權限取聯集)*/
export const roleMembers = pgTable(
  "role_members",
  {
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    actorId: bigint("actor_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 冗餘 tenant_id 便於 scope 查詢(與 role.tenant_id 一致,app 層保證)
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.actorId] }),
    index("role_members_actor_idx").on(t.tenantId, t.actorId),
  ],
)

/* 表單級權限(角色 × 表單 → 動作集;缺列/空 = 無動作,deny-by-default,OQ-4=A)。
   M7:由單一 level → 動作旗標集(view/create/edit/delete/approve/export/design)。 */
export const formPermissions = pgTable(
  "form_permissions",
  {
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references(() => formDefs.id, { onDelete: "cascade" }),
    actions: text("actions").array().notNull().default(sql`ARRAY[]::text[]`),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.formId] }),
    index("form_permissions_form_idx").on(t.formId),
  ],
)

/* 欄位級權限(角色 × 欄位 → 可見性;缺列 = 繼承表單級;與表單級取交集,較嚴者勝)*/
export const fieldPermissions = pgTable(
  "field_permissions",
  {
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    fieldId: bigint("field_id", { mode: "number" })
      .notNull()
      .references(() => fieldDefs.id, { onDelete: "cascade" }),
    visibility: text("visibility").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.fieldId] }),
    index("field_permissions_field_idx").on(t.fieldId),
    check("field_permissions_visibility", sql`visibility IN ('hidden','read','write')`),
  ],
)

/* P0-4a·uplift 資源軸繼承(docs/modules/R1/authz-resource-inheritance.md)。
   表單分類(每租戶;MVP 平面,parent_id 保留未來 category tree,OQ-ARI-1=A)。 */
export const formCategories = pgTable(
  "form_categories",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    // MVP 恆 NULL(平面);保留欄以利未來 category tree
    parentId: bigint("parent_id", { mode: "number" }).references(
      (): AnyPgColumn => formCategories.id,
      { onDelete: "restrict" },
    ),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("form_categories_tenant_name_uq").on(t.tenantId, t.name),
    index("form_categories_tenant_idx").on(t.tenantId),
  ],
)

/* 分類授權(角色 × 分類 → 動作集;繼承層,位於 form_permissions 覆寫層之下)。
   表單有效權限解析序:owner → form_permissions(覆寫)→ category_permissions(繼承)→ 預設 profile。 */
export const categoryPermissions = pgTable(
  "category_permissions",
  {
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    categoryId: bigint("category_id", { mode: "number" })
      .notNull()
      .references(() => formCategories.id, { onDelete: "cascade" }),
    actions: text("actions").array().notNull().default(sql`ARRAY[]::text[]`),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.categoryId] }),
    index("category_permissions_category_idx").on(t.categoryId),
  ],
)

/* R1·UP-2 視圖系統(docs/modules/R1/views-list.md)。授權/metadata 類 Tier-1 表 —— DRIZZLE 車道 +
   app 層 tenant scope,非 RLS(同 form_categories;view 是「存查詢」非 tenant 記錄資料)。
   config JSONB:{ fields:[fieldId], filter:{combinator,conditions[]}, sorts:[{field,dir}], search?, pageSize? }。
   forcedFilter 刻意不做進 view(OQ-VL-2:列級安全歸 authz 軸)。 */
export const viewDefs = pgTable(
  "view_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => formDefs.id),
    name: text("name").notNull(),
    // 'personal'(僅建立者)| 'shared'(租戶可見,建立限 admin/設計者)
    scope: text("scope").notNull().default("personal"),
    // 進表自動套用(僅 shared 可為 default;每 (tenant,form) 至多一筆)
    isDefault: boolean("is_default").notNull().default(false),
    // config-lock(admin;僅鎖組態編輯,非列級安全,Airtable locked view 語意)
    locked: boolean("locked").notNull().default(false),
    config: jsonb("config").notNull(),
    position: integer("position").notNull().default(0),
    createdBy: bigint("created_by", { mode: "number" }).references((): AnyPgColumn => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("view_def_tenant_form_name_uq")
      .on(t.tenantId, t.formId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("view_def_one_default_uq")
      .on(t.tenantId, t.formId)
      .where(sql`is_default AND deleted_at IS NULL`),
    index("view_def_tenant_form_idx").on(t.tenantId, t.formId),
    check("view_def_scope", sql`scope IN ('personal','shared')`),
  ],
)

/* R1·後續-1 自訂按鈕定義(metadata 類 → authz Tier-1 DRIZZLE 車道 + app tenant scope,OQ-AA-5)。
   config JSONB 依 action_type:updateSelf{setFields} / pushTo{targetFormId,fieldMap} / openUrl{url}。 */
export const buttonDefs = pgTable(
  "button_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => formDefs.id),
    label: text("label").notNull(),
    actionType: text("action_type").notNull(),
    config: jsonb("config").notNull(),
    confirm: boolean("confirm").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("button_def_tenant_form_idx").on(t.tenantId, t.formId),
    check("button_def_action_type", sql`action_type IN ('updateSelf','pushTo','openUrl')`),
  ],
)

/* 動作執行稽核(記錄類;冪等 key 唯一 → 重試不重複執行,OQ-AA-2 / FMEA A2)。 */
export const actionAudits = pgTable(
  "action_audit",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    buttonId: bigint("button_id", { mode: "number" }),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    recordId: bigint("record_id", { mode: "number" }).notNull(),
    actorId: bigint("actor_id", { mode: "number" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    outcome: text("outcome").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("action_audit_idem_uq").on(t.tenantId, t.idempotencyKey),
    index("action_audit_record_idx").on(t.tenantId, t.formId, t.recordId),
  ],
)

/* R1·後續-1 簽核定義(metadata 車道)。steps JSONB:[{stepNo, approverRoleId, minAmount?, amountField?}]
   —— 金額條件由 ZEN 決策(OQ-AA-4);onCompleteButtonId = 簽核完自動執行之按鈕。 */
export const approvalDefs = pgTable(
  "approval_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => formDefs.id),
    name: text("name").notNull(),
    steps: jsonb("steps").notNull(),
    onCompleteButtonId: bigint("on_complete_button_id", { mode: "number" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("approval_def_tenant_form_idx").on(t.tenantId, t.formId)],
)

/* 簽核實例(狀態機;pending step 由 approve 推進,OQ-AA-1=A 無 DBOS)。
   同一 (form,record) 至多一筆進行中 → 部分唯一索引。 */
export const approvalInstances = pgTable(
  "approval_instance",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    defId: bigint("def_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    recordId: bigint("record_id", { mode: "number" }).notNull(),
    currentStep: integer("current_step").notNull().default(1),
    status: text("status").notNull().default("pending"),
    submittedBy: bigint("submitted_by", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_instance_active_uq")
      .on(t.tenantId, t.formId, t.recordId)
      .where(sql`status = 'pending'`),
    index("approval_instance_lookup_idx").on(t.tenantId, t.formId, t.recordId),
    check("approval_instance_status", sql`status IN ('pending','approved','rejected','withdrawn')`),
  ],
)

/* 簽核步驟決策日誌(audit;不可變) */
export const approvalStepLogs = pgTable(
  "approval_step_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    instanceId: bigint("instance_id", { mode: "number" }).notNull(),
    stepNo: integer("step_no").notNull(),
    actorId: bigint("actor_id", { mode: "number" }).notNull(),
    decision: text("decision").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_step_log_instance_idx").on(t.instanceId),
    check("approval_step_log_decision", sql`decision IN ('approve','reject','submit','withdraw')`),
  ],
)

/* R1·UP-4 autoNumber pattern 計數器(reset scope 用;RLS + weyver_app 車道,寫於記錄 tx 內)。
   reset_key = 依 resetScope 計算(''=全域無 reset / 日期字串 / 群組欄值)。RLS 補於 migration。 */
export const autonumberCounter = pgTable(
  "autonumber_counter",
  {
    fieldId: bigint("field_id", { mode: "number" }).notNull(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    resetKey: text("reset_key").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.fieldId, t.resetKey] })],
)
