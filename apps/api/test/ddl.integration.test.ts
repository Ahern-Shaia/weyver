import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { ddlAudits, tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import {
  FieldBudgetExhaustedError,
  FormNotPendingError,
  InvalidTypeConversionError,
} from "../src/form-engine/errors.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { addFieldSpecSchema, createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let metadata: MetadataService
let ddl: DdlService
let knexDestroy: () => Promise<void>
let tenantA = 0
let tenantB = 0

async function columnsOf(
  table: string,
): Promise<Map<string, { dataType: string; nullable: string }>> {
  const result = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = 'data' AND table_name = $1`,
    [table],
  )
  return new Map(
    result.rows.map((r: { column_name: string; data_type: string; is_nullable: string }) => [
      r.column_name,
      { dataType: r.data_type, nullable: r.is_nullable },
    ]),
  )
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri(), 8)
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0
  metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
})

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

describe("A3 DDL service on real PG", () => {
  it("createForm provisions a physical table with system columns + RLS FORCE", async () => {
    const { form, fields } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "採購單",
        fields: [
          { name: "單號", type: "autoNumber", options: { prefix: "PO-" } },
          { name: "金額", type: "money" },
          { name: "交期", type: "date" },
        ],
      }),
    )
    expect(form.provisionState).toBe("ready")

    const cols = await columnsOf(`t${form.id}`)
    for (const name of [
      "id",
      "tenant_id",
      "version",
      "created_at",
      "created_by",
      "updated_at",
      "updated_by",
      "deleted_at",
    ]) {
      expect(cols.has(name), `missing system column ${name}`).toBe(true)
    }
    const moneyField = fields.find((f) => f.cellValueType === "money")
    const moneyCol = cols.get(`f${moneyField?.id ?? 0}`)
    expect(moneyCol?.dataType).toBe("numeric")
    expect(moneyCol?.nullable).toBe("YES")

    const rls = await pool.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE oid = ('data.t' || $1::text)::regclass`,
      [form.id],
    )
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    /* 兩條:tenant_isolation(PERMISSIVE,跨租戶)+ record_scope(RESTRICTIVE,記錄範圍 #96)。
       RESTRICTIVE 的意義正在於它與前者是 AND —— 少一條就少一層。 */
    const policy = await pool.query<{ polname: string; polpermissive: boolean }>(
      `SELECT polname, polpermissive FROM pg_policy
         WHERE polrelid = ('data.t' || $1::text)::regclass ORDER BY polname`,
      [form.id],
    )
    expect(policy.rows.map((r) => [r.polname, r.polpermissive])).toEqual([
      ["record_scope", false],
      ["tenant_isolation", true],
    ])
  })

  it("creates a subtable with parent FK + line_no", async () => {
    const parent = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "訂單", fields: [{ name: "客戶", type: "text" }] }),
    )
    const child = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "訂單明細",
        parentFormId: parent.form.id,
        fields: [
          { name: "品項", type: "text" },
          { name: "數量", type: "number" },
        ],
      }),
    )
    const cols = await columnsOf(`t${child.form.id}`)
    expect(cols.get("parent_id")?.nullable).toBe("NO")
    expect(cols.has("line_no")).toBe(true)

    const fk = await pool.query(
      `SELECT count(*)::int AS c FROM pg_constraint
       WHERE conrelid = ('data.t' || $1::text)::regclass AND contype = 'f'`,
      [child.form.id],
    )
    expect(fk.rows[0]?.c).toBe(1)
  })

  it("provision failure cleans up and marks failed", async () => {
    const draft = await metadata.createFormDraft(
      tenantA,
      createFormSpecSchema.parse({ name: "衝突表", fields: [{ name: "x", type: "text" }] }),
    )
    await pool.query(`CREATE TABLE data.t${draft.form.id} (already int)`)

    // 直接對 pending 草稿走 provision:物理表已被占 → CREATE 失敗 → 清理 + failed
    await expect(
      (
        ddl as unknown as { provisionForm: (t: number, d: typeof draft) => Promise<void> }
      ).provisionForm(tenantA, draft),
    ).rejects.toThrow()

    const loaded = await metadata.listForms(tenantA)
    const failed = loaded.find((f) => f.id === draft.form.id)
    expect(failed?.provisionState).toBe("failed")
    // 冪等清理:占位表被 DROP IF EXISTS 收走
    const exists = await pool.query(
      `SELECT count(*)::int AS c FROM pg_tables WHERE schemaname = 'data' AND tablename = $1`,
      [`t${draft.form.id}`],
    )
    expect(exists.rows[0]?.c).toBe(0)
  })

  it("rejects re-provisioning a non-pending form", async () => {
    const created = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "已就緒", fields: [{ name: "x", type: "text" }] }),
    )
    await expect(
      (
        ddl as unknown as {
          provisionForm: (t: number, d: typeof created) => Promise<void>
        }
      ).provisionForm(tenantA, created),
    ).rejects.toThrow(FormNotPendingError)
  })

  it("addField appends a nullable column and bumps version", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "品檢表", fields: [{ name: "批號", type: "text" }] }),
    )
    const row = await ddl.addField(
      tenantA,
      form.id,
      addFieldSpecSchema.parse({ name: "評分", type: "rating" }),
    )
    const cols = await columnsOf(`t${form.id}`)
    expect(cols.get(`f${row.id}`)?.dataType).toBe("smallint")
    expect(cols.get(`f${row.id}`)?.nullable).toBe("YES")
    const loaded = await metadata.getForm(tenantA, form.id)
    expect(loaded.form.version).toBe(2)
    expect(loaded.fields.map((f) => f.name)).toEqual(["批號", "評分"])
  })

  it("concurrent addField on same form serializes via advisory lock", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "並發表", fields: [{ name: "base", type: "text" }] }),
    )
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        ddl.addField(tenantA, form.id, addFieldSpecSchema.parse({ name: `欄${i}`, type: "text" })),
      ),
    )
    const loaded = await metadata.getForm(tenantA, form.id)
    expect(loaded.fields).toHaveLength(6)
    const cols = await columnsOf(`t${form.id}`)
    for (const field of loaded.fields) {
      expect(cols.has(`f${field.id}`)).toBe(true)
    }
  })

  it("alterFieldType: whitelist passes metadata-only, non-whitelist rejected", async () => {
    const { form, fields } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "轉換表",
        fields: [
          { name: "信箱", type: "email" },
          { name: "金額", type: "money" },
        ],
      }),
    )
    const emailField = fields[0]
    const moneyField = fields[1]
    if (emailField === undefined || moneyField === undefined) throw new Error("fields missing")

    await ddl.alterFieldType(tenantA, form.id, emailField.id, "text")
    const loaded = await metadata.getForm(tenantA, form.id)
    expect(loaded.fields.find((f) => f.id === emailField.id)?.cellValueType).toBe("text")
    // 物理型別不變
    const cols = await columnsOf(`t${form.id}`)
    expect(cols.get(`f${emailField.id}`)?.dataType).toBe("text")

    await expect(ddl.alterFieldType(tenantA, form.id, moneyField.id, "text")).rejects.toThrow(
      InvalidTypeConversionError,
    )
  })

  it("moveField swaps adjacent positions (metadata-only) and no-ops at boundary", async () => {
    const { form, fields } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "排序表",
        fields: [
          { name: "甲", type: "text" },
          { name: "乙", type: "text" },
          { name: "丙", type: "text" },
        ],
      }),
    )
    const [a, b] = fields
    if (a === undefined || b === undefined) throw new Error("fields missing")

    await ddl.moveField(tenantA, form.id, b.id, "up")
    const afterUp = await metadata.getForm(tenantA, form.id)
    expect(afterUp.fields.map((f) => f.name)).toEqual(["乙", "甲", "丙"])
    expect(afterUp.form.version).toBe(2)

    // 邊界 no-op:第一個往上不變
    const firstId = afterUp.fields[0]?.id ?? 0
    await ddl.moveField(tenantA, form.id, firstId, "up")
    const afterBoundary = await metadata.getForm(tenantA, form.id)
    expect(afterBoundary.fields.map((f) => f.name)).toEqual(["乙", "甲", "丙"])
  })

  it("dropField soft-deletes metadata but keeps the physical column", async () => {
    const { form, fields } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "下架欄位表",
        fields: [
          { name: "保留", type: "text" },
          { name: "下架", type: "text" },
        ],
      }),
    )
    const dropped = fields[1]
    if (dropped === undefined) throw new Error("field missing")
    await ddl.dropField(tenantA, form.id, dropped.id)

    const loaded = await metadata.getForm(tenantA, form.id)
    expect(loaded.fields.map((f) => f.name)).toEqual(["保留"])
    const cols = await columnsOf(`t${form.id}`)
    expect(cols.has(`f${dropped.id}`)).toBe(true)
  })

  it("tenant scoping: B cannot addField to A's form", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "隔離表", fields: [{ name: "x", type: "text" }] }),
    )
    await expect(
      ddl.addField(tenantB, form.id, addFieldSpecSchema.parse({ name: "evil", type: "text" })),
    ).rejects.toThrow()
  })

  /* 🔴 H-2 R7|PG 的 1600 欄是**一生的加總上限**。attnum 永不回收 ——
     本機實測 30 次 add/drop 後 `VACUUM FULL`,`max(attnum)` 仍是 31。
     既有的欄位數配額只數活著的欄位,所以「加了又刪」的表可以永遠通過配額,
     卻在某一天撞上 PG 的硬牆,而使用者看到的會是一句他看不懂的話。

     測試用一句 ALTER TABLE 把高水位推上去(metadata-only,很快),
     不真的跑 1400 次 add/drop。 */
  async function padAttnum(formId: number, to: number): Promise<void> {
    const clauses = Array.from({ length: to }, (_, i) => `ADD COLUMN pad_${String(i)} text`).join(
      ", ",
    )
    await pool.query(`ALTER TABLE data.t${String(formId)} ${clauses}`)
  }

  it("🔴 attnum 逼近一生上限時擋下加欄,且訊息講得出出路", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "欄位額度用盡", fields: [{ name: "x", type: "text" }] }),
    )
    await padAttnum(form.id, 1400)
    await expect(
      ddl.addField(tenantA, form.id, addFieldSpecSchema.parse({ name: "再一欄", type: "text" })),
    ).rejects.toThrow(FieldBudgetExhaustedError)
    /* 刪掉一堆欄位也救不回來 —— 這正是本檢查存在的理由 */
    await pool.query(
      `ALTER TABLE data.t${String(form.id)} ${Array.from({ length: 200 }, (_, i) => `DROP COLUMN pad_${String(i)}`).join(", ")}`,
    )
    await expect(
      ddl.addField(tenantA, form.id, addFieldSpecSchema.parse({ name: "還是不行", type: "text" })),
    ).rejects.toThrow(FieldBudgetExhaustedError)
  })

  it("越過壓力線仍可加欄,但用量寫進 ddl_audit(接近上限時查得到是哪張表)", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "欄位額度吃緊", fields: [{ name: "x", type: "text" }] }),
    )
    await padAttnum(form.id, 900)
    const added = await ddl.addField(
      tenantA,
      form.id,
      addFieldSpecSchema.parse({ name: "還加得進去", type: "text" }),
    )
    expect(added.id).toBeGreaterThan(0)
    const audits = await db.select().from(ddlAudits)
    const row = audits.find(
      (a) => a.formId === form.id && a.action === "addField" && a.result === "ok",
    )
    expect((row?.spec as { attnumUsed?: number } | undefined)?.attnumUsed).toBeGreaterThanOrEqual(
      900,
    )
  })

  it("writes ddl_audit rows for ok and failed operations", async () => {
    const audits = await db.select().from(ddlAudits)
    expect(audits.length).toBeGreaterThan(0)
    expect(audits.some((a) => a.result === "ok" && a.action === "createForm")).toBe(true)
    expect(audits.some((a) => a.result === "failed")).toBe(true)
    const okCreate = audits.find((a) => a.result === "ok" && a.action === "createForm")
    expect(okCreate?.executedSql).toContain("create table")
    expect(okCreate?.executedSql).toContain("FORCE ROW LEVEL SECURITY")
  })
})
