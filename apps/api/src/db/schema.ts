import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
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
  unique,
  uniqueIndex,
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
  /* 🔴 租戶層強制二步驟驗證(#112)。開啟者本人須先啟用(GitHub 前置規定);
     未啟用者被擋在資源外而非被刪除 —— 登記那條路保持暢通。 */
  requireMfa: boolean("require_mfa").notNull().default(false),
  /* NULL = 不受方案管(現況)。方案內容刻意不入庫(OQ-SB-8=A):
     docs/05 明載其定價「是模型不是斷言」,不把未定案的商業決策固化成程式碼。 */
  planCode: text("plan_code"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /* 🔴 單據日期分界(#105 P1-7)。autoNumber 的日期段與 yearly/monthly/daily 歸零原本走 UTC:
     台灣(UTC+8)在 01/01 08:00 前開的單會拿到**去年**的年度序號、單號日期段也印成去年
     —— 對已列印的憑證是不可回收的錯誤。分界一律以租戶所在時區判定。 */
  timezone: text("timezone").notNull().default("Asia/Taipei"),
  /* R1·A-1 M1 租戶設定。皆有預設或 nullable → 既有租戶零遷移。
     `default_*` 是**預設值**語意:個人可覆寫語言(見 userPrefs),幣別目前無個人軸。 */
  taxId: text("tax_id"),
  /* ⚠️ 2026-08-06 查:**此欄零 writer** —— 有 reader(`getTenant` 回傳、前端 schema
     也宣告了)卻沒有任何地方寫得進去。租戶級資產上傳這條路尚未存在
     (`FilesService.upload` 綁欄位型別,不吃租戶級資產)。圖片浮水印在等同一條路。 */
  logoFileKey: text("logo_file_key"),
  /* R1·後續-2b M2 A3|PDF 浮水印文字(作廢 / 副本 / 機密)。
     圖片浮水印與 logo 同卡在上面那條缺的路上,故此處先只做文字。 */
  pdfWatermarkText: text("pdf_watermark_text"),
  defaultLocale: text("default_locale").notNull().default("zh-Hant"),
  defaultCurrency: text("default_currency").notNull().default("TWD"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

/* 🔴 R1·A-1 M1|個人設定(OQ-SC-2=A 預設+可覆寫 / OQ-SC-3=A 動態繼承)。

   **欄位為 NULL = 繼承租戶值**,不是「關閉」—— 與 notification_pref 的
   「缺列 = 繼承上層」同一語意。改租戶預設會即時反映到所有未自訂者。

   選動態繼承而非「建帳號時複製」:兩家講法相反(Confluence 動態 /
   Google Workspace 只套用到新帳號,且附帶不可逆陷阱「can't switch back」),
   取前者因為「有列才覆寫」天然就是動態繼承、零額外機制。

   ⚠️ `displayTimezone` 只影響**畫面上時間戳怎麼寫出來**;
   業務日界線是 `tenants.timezone`(autoNumber 日期段靠它),**個人不可覆寫**。
   兩者混用會讓報表的「今天」隨看的人而變。 */
/* 🔴 R1·A-1 M4|租戶自行連接的通知通道(OQ-SC-6=A 應用層信封加密)。

   `config` 放**非機密**部分(SMTP host / 頻道 ID…),`secretSealed` 放信封加密後的字串。
   分開的理由:非機密要能顯示與查詢,機密則**永不回顯**
   —— Grafana 的 `secureJsonFields` 只回布林旗標,本專案照抄該語意。

   ⚠️ `secretSealed` 絕不可進 log / 錯誤訊息 / 回應 DTO(OWASP Logging 禁記清單
   逐字含「Access tokens」「Authentication passwords」)。 */
export const notificationChannels = pgTable(
  "notification_channel",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    channel: text("channel").notNull(),
    config: jsonb("config").notNull().default({}),
    /* 管理者勾選要廣播哪些事件。空 = 連上了但不廣播(仍可測試發送)。 */
    broadcastEvents: text("broadcast_events").array().notNull().default(sql`ARRAY[]::text[]`),
    secretSealed: text("secret_sealed"),
    secretFingerprint: text("secret_fingerprint"),
    /* 沒測試成功過就不該被當成可用 —— UI 據此顯示「尚未驗證」 */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedByActorId: bigint("updated_by_actor_id", { mode: "number" }),
  },
  (t) => [unique("notification_channel_unique").on(t.tenantId, t.channel)],
)

export const userPrefs = pgTable(
  "user_pref",
  {
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    actorId: bigint("actor_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    locale: text("locale"),
    displayTimezone: text("display_timezone"),
    /* 跨裝置 UI 偏好的後續退路。M1 不寫入 —— 先建欄不建 UI 會是死控件。 */
    ui: jsonb("ui"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.actorId] })],
)

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
    /* 🔴 E-1 記錄範圍(OQ-DP-2=A / OQ-DP-4=A)。
       範圍是**動作的正交維度**而非新動作 —— 併進 actions 會讓集合爆炸(7 動作 × 2 範圍)。
       逐動作獨立:列在 scopedActions 者受 own 限制,其餘仍是 all。
       這正是 Ragic「佈告欄式」的語意:**看得到全部,但只能改自己的**。
       空陣列 = 全部 all = 既有行為,零遷移。 */
    scopedActions: text("scoped_actions").array().notNull().default(sql`ARRAY[]::text[]`),
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
/* 🔴 F-2 M4|小圖表(widget)。採 Ragic 形態(doc/122):自身篩選 + 可見群組,
   而可見群組為 **widget 級 all-or-nothing**(OQ-PC-9)——
   部分遮蔽會讓聚合值本身變成推論管道(遮掉一格但總和還在,就能反推那一格)。 */
export const widgetDefs = pgTable(
  "widget_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => formDefs.id),
    name: text("name").notNull(),
    chartType: text("chart_type").notNull().default("bar"),
    dimension: text("dimension").notNull(),
    measureFn: text("measure_fn"),
    measureField: text("measure_field"),
    /* 列表頁優先序:固定篩選 > 使用者篩選 > **本欄**(OQ-PC-10 = A)。
       本欄是最低優先,不是唯一來源。 */
    ownFilter: jsonb("own_filter").notNull().default([]),
    placement: text("placement").notNull().default("list"),
    position: integer("position").notNull().default(0),
    /* 空 = **依來源表單權限**(Ragic 語意),不是「所有人可見」 */
    visibleRoleIds: bigint("visible_role_ids", { mode: "number" })
      .array()
      .notNull()
      .default(sql`ARRAY[]::bigint[]`),
    createdBy: bigint("created_by", { mode: "number" }).references((): AnyPgColumn => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("widget_def_form_idx").on(t.tenantId, t.formId, t.placement, t.position)],
)

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
    /* 🔴 F-11|掃描狀態。**刻意不複用上面的 `status`** —— 那是
       `pending|bound|orphaned` 的**生命週期**語意,與掃描結果正交。
       共用會出現「pending 到底是還沒綁記錄還是還沒掃完」這種永遠講不清的狀態。 */
    scanStatus: text("scan_status").notNull().default("pending"),
    scanEngine: text("scan_engine"),
    scanSigVersion: text("scan_sig_version"),
    scanDetail: text("scan_detail"),
    scanAttempts: integer("scan_attempts").notNull().default(0),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    scanNextAttemptAt: timestamp("scan_next_attempt_at", { withTimezone: true }),
    /* 綁定掃的與放行的是同一份位元組(ESET CA8840 即真實 TOCTOU 換 handle 案例) */
    sha256: text("sha256"),
    createdBy: bigint("created_by", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("file_object_tenant_form_idx").on(t.tenantId, t.formId),
    /* 補掃 cron 的取件掃描 */
    index("file_object_scan_due_idx")
      .on(t.scanStatus, t.scanNextAttemptAt)
      .where(sql`scan_status IN ('pending','error')`),
    index("file_object_record_idx").on(t.tenantId, t.formId, t.recordId),
    index("file_object_status_idx").on(t.tenantId, t.status),
    check("file_object_status", sql`status IN ('pending','bound','orphaned')`),
    check(
      "file_object_scan_status",
      sql`scan_status IN ('pending','clean','infected','error','skipped')`,
    ),
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

/* 🔴 R1·C-4 事件觸發器(`docs/modules/R1/event-triggers.md`)。

   與 `buttonDefs` 幾乎同形但**刻意分表**:條件式格式是「顯示時、每次算、無副作用」,
   觸發器是「存檔時、算一次、有副作用」;而按鈕是「有人按才跑」。
   三者的執行時機不同,合表的話「什麼時候會發生」就沒有地方寫。 */
export const triggerDefs = pgTable(
  "trigger_def",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => formDefs.id),
    name: text("name").notNull(),
    onCreate: boolean("on_create").notNull().default(false),
    onUpdate: boolean("on_update").notNull().default(false),
    watchFields: jsonb("watch_fields").notNull().default([]),
    conditions: jsonb("conditions").notNull().default([]),
    actionType: text("action_type").notNull(),
    config: jsonb("config").notNull(),
    /* 🔴 已發布的定義快照。**runtime 只讀這一欄**,上面那些是草稿。
       NULL = 從未發布 → 不會跑。`enabled` 刻意不在裡面(kill switch 要即時)。 */
    published: jsonb("published"),
    /* 🔴 R1·C-5|第三種時機。`schedule_day`:weekly 為 0–6(對齊 PG `dow`),
       monthly 為 1–28 **或 0 = 當月最後一天**。
       上限 28 是刻意的 —— 2 月沒有 29–31,讓使用者選得到一個「有些月份不會發生」
       的日期,等於賣一個會靜默漏跑的設定。月結選 0。 */
    onSchedule: boolean("on_schedule").notNull().default(false),
    scheduleFreq: text("schedule_freq"),
    scheduleHour: integer("schedule_hour"),
    scheduleDay: integer("schedule_day"),
    /* 漏跑補一次的依據(OQ-SCH-5):比的是**換算成租戶時區後的日期**有沒有變,
       不是「距上次幾小時」—— 後者停機三天會補跑 72 次。 */
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    /* 🔴 定時觸發以**建立者的身分**執行。C-4 拒絕系統身分,而排程沒有觸發者 ——
       不記住是誰建的,定時觸發就只能永遠記 `denied`。
       ⚠️ 建立者離職後那條會開始記 `denied`:**可見的失敗,不是靜默的**。 */
    createdBy: bigint("created_by", { mode: "number" }).references((): AnyPgColumn => users.id),
    position: integer("position").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("trigger_def_tenant_form_idx").on(t.tenantId, t.formId),
    check("trigger_def_action_type", sql`action_type IN ('updateSelf','pushTo')`),
    check("trigger_def_has_timing", sql`on_create OR on_update OR on_schedule`),
  ],
)

/* 🔴 執行紀錄。**`denied` 與 `depth` 一定要留得下來** ——
   靜默停止的自動化比不會動的自動化更難查,使用者只會說「它沒反應」。
   DB 端不授 UPDATE / DELETE(見 0055 migration),與 `actionAudits` 同一條理由。 */
export const triggerRuns = pgTable(
  "trigger_run",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    triggerId: bigint("trigger_id", { mode: "number" })
      .notNull()
      .references((): AnyPgColumn => triggerDefs.id),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    recordId: bigint("record_id", { mode: "number" }).notNull(),
    actorId: bigint("actor_id", { mode: "number" }),
    outcome: text("outcome").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("trigger_run_lookup_idx").on(t.tenantId, t.triggerId, t.createdAt),
    check(
      "trigger_run_outcome",
      sql`outcome IN ('ran','skipped','denied','failed','depth','missed')`,
    ),
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

/* 🔴 R1·H-4 記錄修改紀錄(`docs/modules/R1/record-revisions.md`)。

   Ragic 使用者每天在看的「這筆單子被誰改了什麼」。我方原本只有 `updated_by` /
   `updated_at` —— 知道誰、何時,**不知道改了哪一欄、從什麼變成什麼**。

   Tier-1 系統表、不走 RLS、**只增不改**(同 `ddl_audit` / `action_audit` 的形狀)。
   ⚠️ 只存**差異**不存快照(OQ-RV-2):Ragic 逐字「列出該筆資料**詳細的修改內容**」
   就是差異視圖;而快照的成本隨欄數 × 筆數相乘。代價是不能直接還原到某個版本 ——
   **而 Ragic 本來就不給單筆還原**(官方只給大量修改與匯入),代價與 parity 對齊。

   `changes` 以**欄位顯示名**為鍵,與 `record.values` 同一種指涉;
   欄位日後改名時歷史保留當時的名字 —— 那是對的,那次修改當時就叫那個名字。 */
export const recordRevisions = pgTable(
  "record_revision",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    recordId: bigint("record_id", { mode: "number" }).notNull(),
    /* 動態表的 `version` 欄(更新後的值)—— 序號現成,不必另外發號 */
    version: integer("version").notNull(),
    action: text("action").notNull(),
    /* 系統動作(排程 / 還原)可為 null */
    actorId: bigint("actor_id", { mode: "number" }),
    /* [{ field, before, after }];值存**原始值**不存顯示字串(OQ-RV-6)——
       顯示格式會變,存顯示值等於把當時的格式凍進歷史 */
    changes: jsonb("changes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /* v1.2|同一次批次操作(匯入 / 貼上)產生的列共用一個批次 id。
       絕大多數修改紀錄不屬於任何批次 → nullable + 部分索引。 */
    batchId: bigint("batch_id", { mode: "number" }),
  },
  (t) => [
    index("record_revision_record_idx").on(t.tenantId, t.formId, t.recordId, t.id),
    /* P1 的全庫「資料修改紀錄」頁 —— 結構先留好 */
    index("record_revision_recent_idx").on(t.tenantId, t.createdAt),
  ],
)

/* 🔴 R1·H-4 v1.2|**批次**(`docs/modules/R1/record-revisions.md` §7)。

   Ragic 官方 `doc/81` 把整批折成一列:「黃志銘 在 倉庫管理 上 修改 了 4 筆資料
   (大量修改) ↺」—— 不是 4 列各帶一個還原鈕。這張表就是那一列。

   筆數**不存**(OQ-RV-9):讀時 `count(distinct record_id)` 算得出來,
   存了就要回寫、就要再開一個 UPDATE 權限、而且會在回滾時漂移。 */
export const recordBatches = pgTable(
  "record_batch",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    /* import | paste | undo —— `undo` 不得再被還原(OQ-RV-12) */
    kind: text("kind").notNull(),
    actorId: bigint("actor_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: bigint("undone_by", { mode: "number" }),
  },
  (t) => [index("record_batch_recent_idx").on(t.tenantId, t.createdAt)],
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
    /* 🔴 OQ-AP2-10|強制解鎖。**與 withdraw 不同**:withdraw 作廢整個簽核、要從頭送過;
       解鎖是「簽核照跑,但這筆記錄暫時可以改」。沒有它,簽核人一離職記錄就永久鎖死,
       唯一的解是作廢重來 —— 連帶丟掉已簽關卡的稽核意義。 */
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    unlockedByActorId: bigint("unlocked_by_actor_id", { mode: "number" }),
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

/* 🔴 簽核代理人(#104)。簽核者請假時,經過他的單據不該全部卡死 ——
   台灣企業的「職務代理人」是內控慣例,Ragic / Salesforce / SAP 三家都有。
   起訖時間承 SAP 的計畫性代理:請假結束自動失效。 */
export const approvalDelegates = pgTable(
  "approval_delegate",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    principalActorId: bigint("principal_actor_id", { mode: "number" }).notNull(),
    delegateActorId: bigint("delegate_actor_id", { mode: "number" }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    /* NULL = 無限期(非計畫性代理,例如離職交接) */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdByActorId: bigint("created_by_actor_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approval_delegate_lookup_idx").on(t.tenantId, t.delegateActorId, t.startsAt)],
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
    /* 🔴 非 NULL = 這是一次**代理**行為,且指名被代理者是誰。
       只記「B 核准」的話,代理在事後完全看不見 —— 稽核無法回答
       「為什麼是 B 批的?他有權嗎?」 */
    onBehalfOfActorId: bigint("on_behalf_of_actor_id", { mode: "number" }),
    comment: text("comment"),
    /* 🔴 OQ-AP2-9|hash chain 之偵測層。**由 DB trigger 產生,應用層不寫也不該寫** ——
       任何 INSERT 路徑都會被串進鏈裡,繞過服務層也一樣。
       NULL = 這一列早於 chain 上線(0048 之前),不是竄改。 */
    prevHash: text("prev_hash"),
    hash: text("hash"),
    /* 🔴 OQ-AP2-5|臨時加簽:`decision='addApprover'` 時 `actorId` 是**被加的人**,
       這一欄是**加人的人**。兩者分開存,否則事後看不出是誰決定擴大簽核圈。
       刻意不入 hash 算式 —— 改算式會讓所有既有列判定為 tampered。 */
    addedByActorId: bigint("added_by_actor_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_step_log_instance_idx").on(t.instanceId),
    check(
      "approval_step_log_decision",
      sql`decision IN ('approve','reject','submit','withdraw','addApprover','return','unlock')`,
    ),
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
    /* 🔴 **兩者恰有其一**(DB CHECK 執法):
       個人通知有 recipientActorId;群組廣播有 broadcastChannel、沒有收件使用者。
       群組沒有訂閱者也沒有權限模型可依靠(notifications.md §4.6)—— 這正是
       「廣播內容不得含欄位值」由偏好升級為不可協商的理由。 */
    recipientActorId: bigint("recipient_actor_id", { mode: "number" }).references(() => users.id, {
      onDelete: "cascade",
    }),
    broadcastChannel: text("broadcast_channel"),
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
    /* scope='tenant' 時為 **0**(不是 NULL)。
       **不能用 NULL**:唯一索引中 `NULL ≠ NULL`,`ON CONFLICT` 永遠不觸發
       → 每次改租戶層偏好都新增一列而非更新,解析時取到過期值(e2e 實際踩到)。 */
    scopeId: bigint("scope_id", { mode: "number" }).notNull().default(0),
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

/* 🔴 記錄快照(#113,深研見 field-types-parity.md §0-ter A)。

   **問題**|lookup / rollup 目前是虛擬欄,值在每次讀取時即時 join 出來 = 全部 live。
   代表主檔一改,**去年的舊單據顯示內容跟著被改寫**,而且是靜默的:
   沒有事件、沒有記錄、原值已不存在。Odoo #23756 正是這個(2018 開至今 OPEN),
   Airtable / Baserow 社群長年抱怨(「Who wants all invoices to change when the product price changes???」)。

   **決定性論點是失敗不對稱**|live 出錯不可觀察且不可修復;
   snapshot 出錯只是使用者看到舊值,立即可見、按一下重載即可。企業級選失敗可見的那一邊。

   **為什麼是側表而不是把值寫進動態表的物理欄**|
   lookup / rollup **本來就不在真實表裡**(虛擬欄),故側表不損失任何「真實表可讀」的性質;
   反之若改成實體欄,每個 lookup 都要 ADD COLUMN,而 PG 的 1600 欄上限
   **連 DROP 掉的欄位都仍計入**(官方明載)—— 在使用者可自由增刪欄位的平台上不划算。
   側表另有一個好處:凍結與未凍結是**明確的兩態**,不必用 NULL 去猜。

   凍結時機目前為簽核完成(見 SnapshotService)。承 AGENTS 鐵則 4 傳票不可變;
   證據錨:Odoo secure posted entries hash、SAP billing document 後不再重算定價。 */
export const recordSnapshots = pgTable(
  "record_snapshot",
  {
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    recordId: bigint("record_id", { mode: "number" }).notNull(),
    /* 凍結當下的計算欄值:{ 欄名: 值 }。只放 lookup / rollup,
       使用者自填欄本來就在真實表裡,不需要也不該複製一份。 */
    values: jsonb("values").notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull().defaultNow(),
    // 'approval' 等 —— 日後多一種凍結時機時,才知道這筆是誰凍的
    frozenReason: text("frozen_reason").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.formId, t.recordId] })],
)

/* 🔴 匯入批次(#106,深研見 import-to-existing-form.md §0)。

   **為什麼要有這兩張表**|業界沒有一家做到「匯入是原子交易」
   (Salesforce / NetSuite / Odoo / Shopify 全部部分提交)。真正的護欄是
   **匯入前 dry-run + 匯入後可撤銷**,不是 rollback。而可撤銷需要 before-image。

   **原構想的兩個致命缺口(已修)**|
   (G1) 只在記錄上標 `import_batch_id` → **更新型變更完全撤不回來**,
        而遷移場景「每天匯入既有表」絕大多數是更新不是新增。
   (G2) batch_id 掛在記錄上會被**第二批匯入覆蓋** —— 記錄先被 A 新增再被 B 更新,
        只能留一個 batch_id。故 batch↔record 的關係一律放側表,記錄表上不掛任何欄位。 */
export const importBatches = pgTable(
  "import_batch",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    actorId: bigint("actor_id", { mode: "number" }).notNull(),
    /* 'import' | 'revert' —— **撤銷是補償批次不是刪歷史**(AGENTS 鐵則 4),
       故撤銷本身也是一筆 batch,且可再被撤銷(等同 redo)。 */
    kind: text("kind").notNull().default("import"),
    revertOfBatchId: bigint("revert_of_batch_id", { mode: "number" }),
    status: text("status").notNull().default("planned"),
    // 完整 plan 設定原樣保存供稽核(政策 / key / 映射 / 各項開關)
    policy: jsonb("policy").notNull(),
    stats: jsonb("stats").notNull().default({}),
    /* 防「看的是 A 檔、送的是 B 檔」:commit 必須帶回 plan 當下的 hash */
    planHash: text("plan_hash").notNull(),
    /* 來源檔內容雜湊(稽核用:這批是哪一份檔案匯進來的)。planHash 涵蓋整份輸入,
       但它會隨映射設定改變;檔案雜湊才能回答「同一份檔是不是被匯了兩次」。 */
    sourceFileSha256: text("source_file_sha256"),
    /* 🔴 OQ-IMP-1 撤銷保留期 30 天(HubSpot 14 天 / Zoho 4 小時 / Baserow 5 秒)。
       逾期不給撤銷 —— 不是因為資料不見了(diff 仍在),而是因為越久遠的還原
       越可能吃掉他人後續的編輯,Ragic 官方也只敢寫「不建議還原久遠的修改」。 */
    revertExpiresAt: timestamp("revert_expires_at", { withTimezone: true }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_batch_form_idx").on(t.tenantId, t.formId, t.createdAt)],
)

export const importBatchRows = pgTable(
  "import_batch_row",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    batchId: bigint("batch_id", { mode: "number" })
      .notNull()
      .references(() => importBatches.id),
    // 原始檔列號 —— 錯誤檔要能讓使用者回去改那一列(對齊 NetSuite 的錯誤報告形狀)
    sourceRowNo: integer("source_row_no").notNull(),
    // insert | update | noop | skip | error
    op: text("op").notNull(),
    recordId: bigint("record_id", { mode: "number" }),
    matchKeyText: text("match_key_text"),
    /* **只存本次真的改到的欄位**(diff,非整列)—— 體積可控,且撤銷時
       只還原這次動過的欄位,不會連帶蓋掉別人改的其他欄位。 */
    beforeImage: jsonb("before_image"),
    /* 撤銷時做 **per-field compare-and-set**:當前值 == after 才還原成 before。
       不相等代表匯入後有人改過 → 跳過並列入衝突報告(修 G3;Ragic 沒解決這點,
       只在文件警告「不建議還原久遠的修改」)。 */
    afterImage: jsonb("after_image"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("import_batch_row_batch_idx").on(t.tenantId, t.batchId),
    index("import_batch_row_record_idx").on(t.tenantId, t.recordId),
  ],
)

/* 🔴 型別轉換的原值快照(#105,深研見 field-types-parity.md §0-ter B)。

   **為什麼是側表而不是影子欄**|研究原本建議「轉換前把原值複製到同表的影子欄」,
   但 PG 16 官方明載:**DROP 掉的欄位仍計入 1600 欄上限**,只有 VACUUM FULL /
   pg_repack 重建整表才回收。在使用者可自由增刪欄位、且設計期反覆改型別是常態的
   平台上,影子欄會把額度吃光而且要不回來。
   (Baserow 用影子欄,但它只留 **120 分鐘** —— 短窗口才划得來,而其原始碼也自承
   「fast but not suitable for actually backing up the data」。)

   側表另有兩個好處:不會被 `SELECT *` 或 information_schema 反射意外撈出去;
   TTL 清理是 `DELETE WHERE expires_at < now()` 而不是 DDL。

   header 直接用 `ddl_audit` 那一列(已存 from/to/kind),不另立表。 */
export const fieldConversionSnapshots = pgTable(
  "field_conversion_snapshot",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    // 對應 ddl_audit.id —— 一次轉換就是一批
    conversionId: bigint("conversion_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    fieldId: bigint("field_id", { mode: "number" }).notNull(),
    recordId: bigint("record_id", { mode: "number" }).notNull(),
    /* 原值以 jsonb 存(text / 陣列 / 數字皆可容納);還原時依原型別轉回 */
    oldValue: jsonb("old_value"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("field_conversion_snapshot_batch_idx").on(t.tenantId, t.conversionId),
    index("field_conversion_snapshot_expiry_idx").on(t.expiresAt),
  ],
)

/* H-2 回收桶索引(**租戶資料 → RLS 車道**,與 records 同級)。

   本表**不是刪除的真實來源** —— 真實來源仍是各實體自己的 `deleted_at`。
   本表是「使用者看得到、能還原」的**索引 + 刪除當下的快照**:
   - `title` 是刪除當下的顯示名。不存的話,還原清單得回查已刪的 metadata 才知道那是什麼。
   - `relatedIds` 抄 Baserow `trash_entry.related_items`:記下**當初連帶刪了什麼**
     (刪表單時一併軟刪的欄位)。沒有它,還原表單會把「刪表之前就已個別刪掉的欄位」
     一起復活 —— 那不是使用者要的。

   🔴 **purge job 不依賴本表**:它直接掃各表的 `deleted_at`。
   沒有 entry 的軟刪資料照樣會被硬刪(合規不能有死角),掃到時順手把對應 entry 標 purged。 */
export const trashEntries = pgTable(
  "trash_entry",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: bigint("resource_id", { mode: "number" }).notNull(),
    // record/field 的所屬表單;form 自身則等於 resourceId。權限過濾以此為軸
    formId: bigint("form_id", { mode: "number" }),
    title: text("title").notNull(),
    relatedIds: bigint("related_ids", { mode: "number" }).array().notNull().default([]),
    detail: jsonb("detail").notNull().default({}),
    deletedBy: bigint("deleted_by", { mode: "number" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("trashed"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    /* 同一資源同時至多一筆「在回收桶裡」;還原後再刪可再開一筆。
       🔴 **必須含 form_id**:記錄 id 是每張動態表各自的 identity,表 A 和表 B 都有 record 1。
       漏掉 form_id 時,第二張表刪 record 1 會撞第一張表那筆,
       而插入是 ON CONFLICT DO NOTHING → entry 被靜默吞掉,記錄刪了但回收桶裡沒有(0032)。 */
    uniqueIndex("trash_entry_active_uq")
      .on(t.tenantId, t.resourceType, sql`COALESCE(${t.formId}, 0)`, t.resourceId)
      .where(sql`state = 'trashed'`),
    index("trash_entry_list_idx").on(t.tenantId, t.state, t.deletedAt),
    index("trash_entry_purge_idx").on(t.purgeAfter).where(sql`state = 'trashed'`),
    check("trash_entry_type", sql`resource_type IN ('record','form','field')`),
    check("trash_entry_state", sql`state IN ('trashed','restored','purged')`),
  ],
)

/* G-1 M1|事件匯流排 outbox。**與業務變更同一 tx 落列**(AGENTS ⚙️ Outbox pattern)。

   為什麼需要它,而不是在 RecordService 直接呼叫通知 / 送 webhook:
   - webhook 送出是網路 I/O,絕不能佔著業務交易
   - 一份事件源同時餵通知與 webhook,不會出現「通知有、webhook 沒有」的漂移
   - crash 不丟事件(這正是 `record.created` 過去從未送達的反面)

   `sequence` 為 per (tenant, form, record) 遞增:業界一致**不保證投遞順序**
   (Stripe / Shopify 皆明載),消費端靠此丟棄舊序號。 */
export const eventOutbox = pgTable(
  "event_outbox",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    // Standard Webhooks 命名:資源單數 + 動作過去式(record.created)
    type: text("type").notNull(),
    formId: bigint("form_id", { mode: "number" }),
    recordId: bigint("record_id", { mode: "number" }),
    actorId: bigint("actor_id", { mode: "number" }),
    sequence: bigint("sequence", { mode: "number" }).notNull().default(0),
    /* 🔴 只放**非敏感的參照資訊**,不放欄位值。
       載荷在投遞當下依訂閱主體的 ACL 重算(webhook.md §4.4),
       這裡先存下來就等於凍結了一份不受權限變更影響的快照。 */
    meta: jsonb("meta").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    // 扇出完成即標記;未完成者由 cron 重掃(可重入)
    fannedOutAt: timestamp("fanned_out_at", { withTimezone: true }),
    /* 🔴 R1·C-4 M3|觸發器消費者的**獨立**標記。與 `fannedOutAt` 分開,
       否則觸發器失敗重試會讓通知與 webhook 一起重送(它們是 at-least-once 的)。 */
    triggerRunAt: timestamp("trigger_run_at", { withTimezone: true }),
    /* 連鎖深度。由觸發器建出來的記錄,其事件由 worker 補上父深度 + 1。 */
    depth: integer("depth").notNull().default(0),
    triggerAttempts: integer("trigger_attempts").notNull().default(0),
    /* 🔴 FMEA T7|這一串連鎖是哪一次**使用者動作**引起的。
       NULL = 我自己就是源頭。用來限「一次存檔最多連帶產生幾筆」——
       `depth` 限鏈長擋不住分支,兩者相乘會爆。 */
    rootEventId: bigint("root_event_id", { mode: "number" }),
  },
  (t) => [
    index("event_outbox_pending_idx").on(t.occurredAt).where(sql`fanned_out_at IS NULL`),
    index("event_outbox_trigger_pending_idx").on(t.occurredAt).where(sql`trigger_run_at IS NULL`),
    index("event_outbox_root_idx").on(t.rootEventId).where(sql`root_event_id IS NOT NULL`),
    index("event_outbox_tenant_idx").on(t.tenantId, t.occurredAt),
  ],
)

/* G-1 M3|Webhook 訂閱。URL 由租戶使用者自填 → SSRF 是 P0(docs/22 威脅前三)。

   `secret` 存**明文**是刻意的:HMAC 簽章需要原始秘鑰才能計算,不像密碼可以只存 hash。
   代價以「僅簽發時回傳一次 + DB 層 RLS + log redact」控制。
   `secretPrev` 給零停機輪替:輪替後兩把並存,同一 header 出兩個簽章(Standard Webhooks)。 */
export const webhookEndpoints = pgTable(
  "webhook_endpoint",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    url: text("url").notNull(),
    description: text("description"),
    // 訂閱的事件型別;空陣列 = 全訂
    eventTypes: text("event_types").array().notNull().default([]),
    secret: text("secret").notNull(),
    secretPrev: text("secret_prev"),
    secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
    /* 啟用前挑戰(Slack url_verification / Notion verification_token 同模式):
       未通過者不得投遞 —— 除了證明端點可控,也避免平台淪為打第三方的放大器 */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifyToken: text("verify_token"),
    /* 🔴 載荷以此主體的欄位 ACL 產生,不是以觸發變更那位使用者的權限(§4.4)。
       null = 僅送 thin(無欄位值),不需要主體 */
    subjectActorId: bigint("subject_actor_id", { mode: "number" }),
    // thin(預設)只帶參照;fat 需逐欄白名單
    payloadMode: text("payload_mode").notNull().default("thin"),
    fatFieldIds: bigint("fat_field_ids", { mode: "number" }).array().notNull().default([]),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    // 自動停用的雙條件判定用(Svix:避免消費端一次短暫維護就被停)
    firstFailureAt: timestamp("first_failure_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdBy: bigint("created_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("webhook_endpoint_tenant_idx").on(t.tenantId).where(sql`deleted_at IS NULL`),
    check("webhook_endpoint_payload_mode", sql`payload_mode IN ('thin','fat')`),
  ],
)

/* 投遞紀錄。欄位形狀刻意比照 `notification_delivery` —— 那套 cron 抽取 + 退避
   已在 prod 驗證過,復用勝過為它引進 BullMQ(OQ-WH-1=A;且 BullMQ 的 group
   併發是 Pro 商業功能,OSS-only 下引進也換不到順序保證)。 */
export const webhookDeliveries = pgTable(
  "webhook_delivery",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    endpointId: bigint("endpoint_id", { mode: "number" }).notNull(),
    eventId: bigint("event_id", { mode: "number" }),
    /* 對外的 webhook-id。**重送時沿用同一個**,消費端才去重得掉(GitHub 同做法) */
    messageId: text("message_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    responseCode: integer("response_code"),
    // 截斷後存;秘鑰與授權 header 一律 redact
    responseBody: text("response_body"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /* W7|載荷與回應內容已過保留期被清除。**同時是重送的閘門** ——
       內容沒了還讓人按重送,送出去的會是一份空載荷,而且不會有任何錯誤。 */
    prunedAt: timestamp("pruned_at", { withTimezone: true }),
  },
  (t) => [
    index("webhook_delivery_due_idx").on(t.status, t.nextAttemptAt).where(sql`status = 'pending'`),
    index("webhook_delivery_endpoint_idx").on(t.tenantId, t.endpointId, t.createdAt),
    check("webhook_delivery_status", sql`status IN ('pending','sent','failed')`),
  ],
)

/* G-1 M4|API 金鑰。**只存 hash** —— 與 webhook secret 不同,驗證時我們拿得到明文
   (client 送上來),所以沒有存明文的理由。前綴另存供 UI 辨識(`wvk_live_ab12…`)。 */
export const apiKeys = pgTable(
  "api_key",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    /* 以哪個 actor 的權限執行 —— 金鑰不得擁有超出該人的權限,
       否則金鑰就成了提權管道(對齊 webhook 的 subjectActorId 同一原則) */
    subjectActorId: bigint("subject_actor_id", { mode: "number" }).notNull(),
    scopes: text("scopes").array().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_key_hash_uq").on(t.keyHash),
    index("api_key_tenant_idx").on(t.tenantId).where(sql`revoked_at IS NULL`),
  ],
)

/* G-2 M1|公開表單分享。把一張內部表單開放給**未登入者**填寫。

   🔴 **`fieldIds` 是 opt-in 白名單,不是「排除清單」。**
   若採排除制,日後有人在表單加一個成本欄,那一刻就外洩了 ——
   安全預設必須是「新東西預設不公開」,而不是「記得去排除」。

   `tokenHash`|分享網址帶的是高熵明文,DB 只存 hash(與 API 金鑰同理:
   驗證時明文會被送上來,沒有存明文的必要)。 */
export const publicFormShares = pgTable(
  "public_form_share",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    tokenHash: text("token_hash").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // opt-in 白名單:只有列在這裡的欄位會被渲染、被接受
    fieldIds: bigint("field_ids", { mode: "number" }).array().notNull().default([]),
    // 關閉條件(Fillout 最完整,取其三)
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    maxSubmissions: integer("max_submissions"),
    closedMessage: text("closed_message"),
    submissionCount: integer("submission_count").notNull().default(0),
    /* 🔴 預設禁附件(OQ-PF-6)。F-11 已交付掃毒與下載閘(未 clean 不可取用),
       但要對匿名者開放還缺:per-share 附件配額、逾時未 clean 自動刪除、
       獨立的匿名上傳限流。三者齊備前維持關閉(#121)。 */
    allowAttachments: boolean("allow_attachments").notNull().default(false),
    requireCaptcha: boolean("require_captcha").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdBy: bigint("created_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("public_form_share_token_uq").on(t.tokenHash),
    index("public_form_share_tenant_idx").on(t.tenantId).where(sql`deleted_at IS NULL`),
  ],
)

/* 🔴 匿名提交**不直接寫進動態表**,先落待審收件匣(OQ-PF-7)。

   各家問卷平台都不隔離(Airtable 甚至提供 trigger 方便你串自動化),
   因為問卷沒有這個需求。但 ERP 定位下,一筆匿名提交直接觸發簽核、
   吃掉正式單號、污染主檔是不可接受的。**這是刻意不照抄業界的地方。**

   隔離同時解掉三個問題:
   - 自動編號不被匿名者消耗(也就不會被用來推算業務量)
   - 唯一值衝突不會變成 existence oracle(提交當下不檢查唯一性)
   - 公式 / 簽核 / 通知 / webhook 一律等到 promote 才觸發 */
export const publicSubmissions = pgTable(
  "public_submission",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    shareId: bigint("share_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    // 以欄位名為鍵的原始提交值(尚未進動態表)
    values: jsonb("values").notNull(),
    status: text("status").notNull().default("pending"),
    // promote 後指向真正建立的記錄
    recordId: bigint("record_id", { mode: "number" }),
    rejectReason: text("reject_reason"),
    // 只存 hash:留追查能力但不留可回推的個資
    submitterIpHash: text("submitter_ip_hash"),
    submitterUa: text("submitter_ua"),
    reviewedBy: bigint("reviewed_by", { mode: "number" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("public_submission_inbox_idx").on(t.tenantId, t.status, t.createdAt),
    index("public_submission_share_idx").on(t.shareId),
    check("public_submission_status", sql`status IN ('pending','promoted','rejected')`),
  ],
)

/* 🔴 R1·A-1 M2|成員狀態(停權)。**逐成員而非逐帳號** ——
   一個 Better Auth 帳號可屬多個 org,甲公司停權不得影響他在乙公司的存取。
   故停權的語意是「擋進入該租戶」而非「擋登入產品」(見 migration 0040 檔頭)。
   缺列 = active,既有成員零遷移。 */
export const memberStates = pgTable(
  "member_state",
  {
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    actorId: bigint("actor_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedBy: bigint("suspended_by", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.actorId] })],
)

/* 🔴 初始密碼是**一次性憑證**不是密碼(ASVS §V6.4.1:短效期 **或** 用過即失效 —— 兩者都做)。
   本表**不存密碼本身**,只記「該帳號持有一組未使用的初始憑證」;雜湊仍由 Better Auth 保管。
   刻意無 RLS:登入流程須在租戶語境建立**之前**判斷是否強制改密碼(同 `tenants`)。
   收斂改走權限 —— app 車道只有 SELECT / UPDATE,**無 INSERT**,簽發只能走服務層特權路徑。 */
export const initialCredentials = pgTable("initial_credential", {
  authUserId: text("auth_user_id").primaryKey(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  issuedByActorId: bigint("issued_by_actor_id", { mode: "number" }).notNull(),
  issuedInTenantId: bigint("issued_in_tenant_id", { mode: "number" })
    .notNull()
    .references(() => tenants.id),
})

/* 🔴 R1·A-1 M3|認證事件稽核(保留 6 個月;台灣資安分級辦法附表十)。
   `action_audit` 的 form_id / record_id 皆 NOT NULL,結構上放不了認證事件 → 另立一表。
   `authUserId` / `tenantId` 皆可為 NULL:登入失敗發生在租戶語境建立**之前**,
   而那正是最需要記錄的事件之一;強制 NOT NULL 等於把它排除在稽核外。
   **只記 metadata** —— OWASP Logging 禁記清單含密碼 / token / session id。 */
export const authAudits = pgTable(
  "auth_audit",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    authUserId: text("auth_user_id"),
    tenantId: bigint("tenant_id", { mode: "number" }),
    event: text("event").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_audit_user_idx").on(t.authUserId, t.createdAt)],
)

/* 🔴 R1·I-1|資料匯出的工作佇列(#145)。狀態機 queued → running → ready|failed,
   到期後 ready → expired(**列不刪** —— 誰把整包公司資料帶走了是內控要問的)。 */
/* 🔴 R1·後續-2b|伺服器端 PDF 工作(`docs/modules/R1/server-pdf.md`)。
   佇列形狀沿用 `export_job`:狀態欄就是佇列,一支 worker 以 SKIP LOCKED 取件。

   `ticketHash` 是 OQ-PDF-6 的落點:渲染器是**沒有身分的瀏覽器**,
   而 PDF 必須以請求者的權限產生 —— 票讓它換得到資料,而換資料時
   後端以**該工作的 actor** 去讀,遮罩走既有的同一條路。只存雜湊。 */
export const pdfJobs = pgTable(
  "pdf_job",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    requestedByActorId: bigint("requested_by_actor_id", { mode: "number" }).notNull(),
    formId: bigint("form_id", { mode: "number" }).notNull(),
    recordIds: bigint("record_ids", { mode: "number" }).array().notNull(),
    status: text("status").notNull().default("queued"),
    objectKey: text("object_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    ticketHash: text("ticket_hash"),
    ticketUsedAt: timestamp("ticket_used_at", { withTimezone: true }),
    downloadCount: integer("download_count").notNull().default(0),
    /* 給使用者看的訊息 —— 不得放內部細節 */
    error: text("error"),
    /* M2 A3|把記錄的附件 PDF 併進單據。預設關 —— 理由見 migration 0063。 */
    mergeAttachments: boolean("merge_attachments").notNull().default(false),
    /* 沒併進去的附件與原因。靜默略過等於讓使用者拿到一份看似完整的東西。 */
    mergeReport: jsonb("merge_report").$type<readonly PdfMergeSkip[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("pdf_job_tenant_idx").on(t.tenantId, t.createdAt)],
)

export type PdfMergeSkipReason =
  | "not-pdf"
  | "encrypted"
  | "unreadable"
  | "too-large"
  | "unavailable"
  | "page-cap"

export interface PdfMergeSkip {
  readonly name: string
  readonly reason: PdfMergeSkipReason
}

export const exportJobs = pgTable(
  "export_job",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    requestedByActorId: bigint("requested_by_actor_id", { mode: "number" }).notNull(),
    status: text("status").notNull().default("queued"),
    /* NULL = 全部表單 */
    formIds: bigint("form_ids", { mode: "number" }).array(),
    includeAttachments: boolean("include_attachments").notNull().default(false),
    objectKey: text("object_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    rowCount: bigint("row_count", { mode: "number" }),
    downloadCount: integer("download_count").notNull().default(0),
    /* 給使用者看的訊息 —— 不得放內部細節 */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("export_job_tenant_idx").on(t.tenantId, t.createdAt)],
)

/* R1·AI-1 M1|AI 設定(BYO key)。一租戶一列 → tenant_id 直接當 PK。
   🔴 `apiKeySealed` **永不出 service** —— 對外只給 `apiKeyHint`(末四碼)。 */
export const tenantAiConfig = pgTable("tenant_ai_config", {
  tenantId: bigint("tenant_id", { mode: "number" }).primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  provider: text("provider"),
  model: text("model"),
  apiKeySealed: text("api_key_sealed"),
  apiKeyHint: text("api_key_hint"),
  /* 資料外送同意(OQ-AI-8=C)。記誰、何時,且可撤回(設 NULL)。 */
  consentAt: timestamp("consent_at", { withTimezone: true }),
  consentByActorId: bigint("consent_by_actor_id", { mode: "number" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

/* 每次呼叫一列,**成功與失敗都記** —— 失敗一樣花錢(provider 多半照收 input token)。
   這張表是稽核紀錄,migration 只授 SELECT/INSERT,沒有 UPDATE。 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull(),
    /* 系統觸發(背景工作)為 NULL */
    actorId: bigint("actor_id", { mode: "number" }),
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    ok: boolean("ok").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_usage_tenant_idx").on(t.tenantId, t.createdAt)],
)
