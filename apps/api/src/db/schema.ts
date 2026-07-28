import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
  /* F-6 M2 per-tenant 資源配額(OQ-REL-2=B)。NULL = 用系統預設值 → 既有租戶零遷移;
     方案分級 / 大客戶調高只需改列,不必改 schema。 */
  maxForms: integer("max_forms"),
  maxFieldsPerForm: integer("max_fields_per_form"),
  maxRecordsPerForm: integer("max_records_per_form"),
  /* F-8 M1 計費地基(OQ-SB-2=A)。三欄皆 nullable / 有預設 → **零行為變化**:
     現有租戶一律 'active' + plan NULL(不受方案管),與加欄前完全相同。
     **停權檢查採白名單式**(只有明確 suspended/cancelled 才擋)—— FMEA B1:
     判斷若寫成黑名單,一個未知值就會擋掉全部客戶。 */
  status: text("status").notNull().default("active"),
  /* NULL = 不受方案管(現況)。方案內容刻意不入庫(OQ-SB-8=A):
     docs/05 明載其定價「是模型不是斷言」,不把未定案的商業決策固化成程式碼。 */
  planCode: text("plan_code"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/* F-8 M1|每日用量快照(OQ-SB-7=A)。**append-only,計費憑據不可改**(承 AGENTS「傳票不可變」)。
   粒度 = 日 × 租戶 × 指標碼;指標碼而非固定欄位 → 日後改「計費使用者」定義時
   用**新指標碼並存**,不改寫歷史(FMEA B5)。
   唯一鍵使 job 冪等且可補算指定日期(FMEA B4)。
   **不設清理 job**:百家租戶 × 10 指標 × 365 ≈ 36 萬列/年,量極小;
   明列於此以免日後誤加清理而砍掉計費憑據(FMEA B8)。 */
export const tenantUsageDaily = pgTable(
  "tenant_usage_daily",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    /* 採計日(UTC 日界;帳務爭議看的是「哪一天」不是時刻)*/
    day: date("day").notNull(),
    /* 指標碼:billable_users / active_users / forms / records / storage_bytes … */
    metric: text("metric").notNull(),
    /* 用 numeric:儲存位元組可超 int4,且金額類指標日後不得用 float(AGENTS P0)*/
    value: numeric("value").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenant_usage_daily_uq").on(t.tenantId, t.day, t.metric),
    index("tenant_usage_daily_tenant_day_idx").on(t.tenantId, t.day),
  ],
)

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

/* F-6 M1 冪等性(AGENTS ⚙️ [P0]:mutation 重試不重複建單)。
   key 由 client 產生,scope 於租戶(PK 含 tenant_id → 不同租戶同 key 互不干擾,FMEA L2)。
   走 **RLS 車道**(與 records 同級 —— 內容含回應快照,屬租戶資料)。
   request_hash:同 key 不同 body = 用戶端錯誤 → 422(Stripe 語意),避免回放錯誤結果。 */
export const idempotencyKeys = pgTable(
  "idempotency_key",
  {
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("in_flight"),
    responseCode: integer("response_code"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
    index("idempotency_key_expiry_idx").on(t.expiresAt),
    check("idempotency_key_status", sql`status IN ('in_flight','done')`),
  ],
)

/* F-5 檔案 metadata(**租戶記錄資料** → RLS 車道,與 records 同級;OQ-FS-7)。
   key 為伺服器生成之物件位址(t{tenant}/f{form}/{uuid}{ext}),**非授權憑證**(OQ-FS-4):
   下載一律回查本表取得 (tenant, form, field) 再驗表單/欄位權限(BOLA 防護,docs/22)。
   status:pending(已上傳未綁記錄)→ bound(記錄存檔時綁定)/ orphaned(逾期未綁)。 */
export const fileObjects = pgTable(
  "file_object",
  {
    key: text("key").primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    fieldId: bigint("field_id", { mode: "number" }).notNull(),
    recordId: bigint("record_id", { mode: "number" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    status: text("status").notNull().default("pending"),
    createdBy: bigint("created_by", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("file_object_tenant_form_idx").on(t.tenantId, t.formId),
    index("file_object_record_idx").on(t.tenantId, t.formId, t.recordId),
    index("file_object_status_idx").on(t.tenantId, t.status),
    check("file_object_status", sql`status IN ('pending','bound','orphaned')`),
  ],
)

/* R1·後續-2 標籤定義(metadata 類 → authz Tier-1 DRIZZLE 車道 + app tenant scope,OQ-PM-5)。
   config JSONB:{ size:{widthMm,heightMm}, tile, gapMm?, showFieldNames?, copiesField?, items:[…] }
   —— items 為欄位堆疊序(非 2D 座標,OQ-PM-2;與 form_def.layout 刻意解耦)。 */
export const labelDefs = pgTable(
  "label_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => formDefs.id),
    name: text("name").notNull(),
    config: jsonb("config").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("label_def_tenant_form_idx").on(t.tenantId, t.formId)],
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

/* ── H-1 通知系統(docs/modules/R1/notifications.md v0.4)────────────────────────

   **通知與寄送刻意分兩張表**(§0.4.2):Discourse / GitLab / Novu 三家皆如此,
   因生命週期(數月 vs 數天)· 寫入模式(寫一次 vs 反覆 UPDATE 產 dead tuple)
   · 扇出(1 則 → N 通道)· 保留策略 四者衝突。v0.3 曾規劃「通知表兼作佇列」,
   經研究確認為已知反模式,故改此形。 */

/* 使用者可見的通知。低頻可操作事件 → 每則一列(Mattermost 式 read-state 指標
   適用於高頻訊息流,不適用 ERP 場景)。 */
export const notifications = pgTable(
  "notification",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    /* 收件人。**多型的另一半(channelTarget / 群組廣播)於 LINE 模組再加**,
       屆時本欄轉為 nullable + 加 target 欄;現在先不預留空欄位(YAGNI),
       但 §4.6 已載明模型方向,加欄為純加法。 */
    recipientActorId: bigint("recipient_actor_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /* 事件碼:approval.pending / approval.approved / approval.rejected /
       approval.overdue / record.created / record.updated */
    event: text("event").notNull(),
    formId: bigint("form_id", { mode: "number" }).references(() => formDefs.id, {
      onDelete: "cascade",
    }),
    recordId: bigint("record_id", { mode: "number" }),
    /* 顯示用文字。**title 不得直接取 fields[0]**(FMEA N14:首欄為使用者自建
       任意欄位,可能是金額 / 身分證號)—— 由 NotificationService 以安全規則產生。
       **一律不含欄位值**(OQ-NT-9):欄位級權限使業界主流的「過濾收件人」失效。 */
    title: text("title").notNull(),
    /* 觸發者(供 UI 顯示「林採購 送出」);非收件人 */
    actorId: bigint("actor_id", { mode: "number" }).references(() => users.id),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* 未讀計數走部分索引(Discourse 實作)—— 未讀是最高頻查詢 */
    index("notification_unread_idx")
      .on(t.tenantId, t.recipientActorId)
      .where(sql`read_at IS NULL`),
    index("notification_recipient_idx").on(t.tenantId, t.recipientActorId, t.createdAt),
  ],
)

/* 外送記錄(每通道一列)。狀態機 pending → sent / failed;M3 才有真正的寄送者。
   `dedupeKey` 供同記錄去抖動與冪等(OQ-NT-8 / AGENTS 冪等鐵則)。 */
export const notificationDeliveries = pgTable(
  "notification_delivery",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    notificationId: bigint("notification_id", { mode: "number" })
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /* 退避重試的下次嘗試時刻;輪詢取件以此為條件(**不用 LISTEN/NOTIFY** ——
       PgBouncer transaction mode 下不可用,AGENTS P0 鐵則要求 tx mode) */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* 取件掃描:只看待送者 */
    index("notification_delivery_due_idx")
      .on(t.status, t.nextAttemptAt)
      .where(sql`status = 'pending'`),
    index("notification_delivery_notification_idx").on(t.notificationId),
  ],
)

/* 訂閱偏好(OQ-NT-15:單一有序 enum,非獨立布林開關)。

   **scope 三層**:tenant(全域預設)/ category / form —— **沿用既有分類資源軸**
   (authz-resource-inheritance 同一條軸),使用者不必學第二套心智模型。
   解析時**最具體者勝**(GitLab 語意):form → category → tenant → 系統預設。
   缺列 = 繼承上層(不是「關閉」)。 */
export const notificationPrefs = pgTable(
  "notification_pref",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    actorId: bigint("actor_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /* 'tenant' | 'category' | 'form' */
    scope: text("scope").notNull(),
    /* scope='tenant' 時為 NULL */
    scopeId: bigint("scope_id", { mode: "number" }),
    /* 有序層級:0 靜音 < 10 與我相關(預設)< 20 新資料+與我相關 < 30 全部 < 40 自訂。
       **有序才可繼承與比較** —— 這正是改用 enum 而非布林開關的主因。 */
    level: smallint("level").notNull(),
    /* 僅 level=40(自訂)有效;GitLab 式「與我相關之上加選」保持有序 */
    customEvents: jsonb("custom_events"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_pref_uq").on(t.tenantId, t.actorId, t.scope, t.scopeId),
    index("notification_pref_actor_idx").on(t.tenantId, t.actorId),
  ],
)

/* 每使用者的總開關與通道選擇(軸 0 + 軸 2;軸 1 層級在 notification_pref)。
   缺列 = 全部預設值(啟用 + 站內開 + Email 開),既有使用者零遷移。 */
export const notificationSettings = pgTable(
  "notification_setting",
  {
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    actorId: bigint("actor_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /* 軸 0 總開關。承 Ragic:關閉時下層設定**鎖住且不發送**,但設定保留不清空。
       **例外**:簽核逾期一律發送(裁定 ④),故此欄不影響 approval.overdue。 */
    enabled: boolean("enabled").notNull().default(true),
    /* 軸 2:事件碼 → 通道開關。缺鍵 = 用系統預設 */
    channels: jsonb("channels"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.actorId] })],
)

/* H-1 M3|寄送抑制清單(P0,非 P1)。

   **不處理退信與投訴 = 網域信譽崩壞 = 全體租戶的通知都進垃圾信**(FMEA N15)。
   Google 每日計算投訴率,**≥0.3% 即喪失 mitigation 資格**,須連續 7 天 <0.3% 才恢復。

   5xx 硬退 → 立即永久 suppress;投訴 → 零重試立即永久 suppress;
   4xx 軟退 → 退避重試,連續失敗升硬退。**寄送前必查**。
   跨租戶共用(信譽是平台層資產,非租戶層)→ 刻意**不帶 tenant_id**。 */
export const emailSuppressions = pgTable(
  "email_suppression",
  {
    email: text("email").primaryKey(),
    /* hard_bounce / complaint / unsubscribe / manual */
    reason: text("reason").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_suppression_reason_idx").on(t.reason)],
)
