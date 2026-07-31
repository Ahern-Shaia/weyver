import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import type { Knex } from "knex"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAppKnex, createDdlKnex, createDrizzle, type DrizzleDb, TenantDb } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { listQuerySchema } from "../src/form-engine/records/record-specs.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

const ACTOR = 1

let container: StartedPostgreSqlContainer
let adminPool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let appRecords: RecordService
let appKnex: Knex
const destroyers: (() => Promise<unknown>)[] = []
let tenantA = 0
let tenantB = 0
let formId = 0
let physicalTable = ""
let contentColumn = ""

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  adminPool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(adminPool)

  // 部署模式:LOGIN 使用者掛進 weyver_app group role(migration 0003 已建 + grants)
  await adminPool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )

  db = createDrizzle(adminPool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0

  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  destroyers.push(() => ddlKnex.destroy())
  ddl = new DdlService(ddlKnex, db, metadata)

  const uri = new URL(container.getConnectionUri())
  uri.username = "app_login"
  uri.password = "app_login"
  appKnex = createAppKnex(uri.toString())
  destroyers.push(() => appKnex.destroy())
  appRecords = new RecordService(appKnex, metadata)

  const created = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "機密表",
      fields: [{ name: "內容", type: "text", required: true }],
    }),
  )
  formId = created.form.id
  physicalTable = `t${formId}`
  contentColumn = `f${created.fields[0]?.id ?? 0}`

  // 各租戶種資料(直接以 admin 寫入,模擬既存資料;tenant_id 不同)
  await adminPool.query(
    `INSERT INTO data.${physicalTable} (tenant_id, f${created.fields[0]?.id}, created_by, updated_by)
     VALUES ($1, 'A 的機密', 1, 1), ($2, 'B 的機密', 1, 1)`,
    [tenantA, tenantB],
  )
})

afterAll(async () => {
  await Promise.all(destroyers.map((d) => d()))
  await adminPool.end()
  await container.stop()
})

function q(input: Partial<Parameters<typeof listQuerySchema.parse>[0]> = {}) {
  return listQuerySchema.parse(input)
}

describe("A6 tenant isolation with real app role (RLS 執法)", () => {
  it("app-lane service reads only its own tenant", async () => {
    const listA = await appRecords.listRecords(tenantA, formId, q())
    expect(listA.records.map((r) => r.values.內容)).toEqual(["A 的機密"])
  })

  it("BOLA killer:app 車道即使『忘記下 WHERE tenant_id』也洩漏不了(RLS 兜底)", async () => {
    const leaked = await appKnex.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantA)])
      // 模擬 app 層 bug:無任何 tenant WHERE 的全表查詢
      return trx.withSchema("data").table(physicalTable).select("*")
    })
    expect(leaked).toHaveLength(1)
    expect((leaked[0] as { tenant_id: string }).tenant_id).toBe(String(tenantA))
  })

  it("無 tenant context → 0 列(fail-closed,非報錯洩訊)", async () => {
    const rows = await appKnex.transaction(async (trx) =>
      trx.withSchema("data").table(physicalTable).select("*"),
    )
    expect(rows).toHaveLength(0)
  })

  it("app 車道偽造他租戶 context 也寫不進去(WITH CHECK)", async () => {
    await expect(
      appKnex.transaction(async (trx) => {
        await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantA)])
        await trx
          .withSchema("data")
          .table(physicalTable)
          .insert({ tenant_id: tenantB, [contentColumn]: "evil", created_by: 1, updated_by: 1 })
      }),
    ).rejects.toThrow(/row-level security/)
  })

  it("app 角色禁 DDL:建表 / 改表全被拒", async () => {
    await expect(appKnex.raw("CREATE TABLE data.evil_table (id int)")).rejects.toThrow(
      /permission denied/,
    )
    await expect(
      appKnex.raw(`ALTER TABLE data.${physicalTable} ADD COLUMN evil text`),
    ).rejects.toThrow(/must be owner|permission denied/)
  })

  it("app 車道端到端:A 建 / 讀自己的;B 連表單 metadata 都看不到(更強)", async () => {
    const created = await appRecords.createRecord(tenantA, formId, { 內容: "app 車道寫入" }, ACTOR)
    expect(created.values.內容).toBe("app 車道寫入")

    // B 的 resolveForm 在 metadata 層即拒(form 屬於 A)→ 記錄層根本到不了
    await expect(appRecords.listRecords(tenantB, formId, q())).rejects.toThrow(/not found/)
    await expect(appRecords.getRecord(tenantB, formId, created.id)).rejects.toThrow(/not found/)
  })
})
