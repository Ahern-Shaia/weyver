import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 追溯稽核 #105 P1-4|「空」的表示法未正規化。
   `""`(空字串)與 NULL 在 PG 是不同的值,但對使用者是同一件事:「沒填」。
   兩個後果都會咬人:
   (a) required 只擋 null → 空字串直通,必填形同虛設
   (b) isEmpty 篩選是 `IS NULL` → 存成 `""` 的列查不到 */

const ACTOR = 1
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let knexDestroy: () => Promise<void>
let tenantA = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)
}, 120_000)

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

describe("🔴 空值正規化(追溯稽核 #105)", () => {
  it("**必填欄不得被空字串繞過** —— required 原本只擋 null", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "必填測試",
        fields: [{ name: "客戶名稱", type: "text", required: true }],
      }),
      ACTOR,
    )

    await expect(records.createRecord(tenantA, form.id, { 客戶名稱: "" }, ACTOR)).rejects.toThrow()
    // 全空白字元同樣是「沒填」
    await expect(
      records.createRecord(tenantA, form.id, { 客戶名稱: "   " }, ACTOR),
    ).rejects.toThrow()
  })

  it("**isEmpty 要查得到空字串存進來的列** —— 原本 IS NULL 會漏抓", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "空值篩選",
        fields: [
          { name: "編號", type: "text" },
          { name: "備註", type: "text" },
        ],
      }),
      ACTOR,
    )

    await records.createRecord(tenantA, form.id, { 編號: "A", 備註: "有值" }, ACTOR)
    await records.createRecord(tenantA, form.id, { 編號: "B", 備註: "" }, ACTOR)
    await records.createRecord(tenantA, form.id, { 編號: "C", 備註: null }, ACTOR)

    const empty = await records.listRecords(tenantA, form.id, {
      filters: [{ field: "備註", op: "isEmpty" }],
      sort: [],
      limit: 50,
    })
    expect(empty.records.map((r) => r.values.編號).sort()).toEqual(["B", "C"])

    const filled = await records.listRecords(tenantA, form.id, {
      filters: [{ field: "備註", op: "isNotEmpty" }],
      sort: [],
      limit: 50,
    })
    expect(filled.records.map((r) => r.values.編號)).toEqual(["A"])
  })

  it("空字串一律落地為 NULL —— 讀回來是 null 而非 ''", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "空值落地",
        fields: [{ name: "備註", type: "text" }],
      }),
      ACTOR,
    )
    const created = await records.createRecord(tenantA, form.id, { 備註: "" }, ACTOR)
    const read = await records.getRecord(tenantA, form.id, created.id)
    expect(read.values.備註).toBeNull()
  })
})
