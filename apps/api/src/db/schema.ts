import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

/* metadata catalog(固定 schema,Drizzle 車道;Tier-2 動態表走 Knex 車道,永不進此檔) */

export const tenants = pgTable("tenants", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
