import { toText } from "@weyver/formula"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDdlKnex, createDrizzle, type DrizzleDb, TenantDb } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { RollupService } from "../src/form-engine/relations/rollup.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

const ACTOR = 1

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let records: RecordService
let rollup: RollupService
let knexDestroy: () => Promise<void>
let tenantA = 0
let poFormId = 0
let lineFormId = 0
let po1 = 0
let po2 = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  const db: DrizzleDb = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }])
    .returning()
  tenantA = rows[0]?.id ?? 0

  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  const ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)
  rollup = new RollupService(records)

  const po = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({ name: "採購單", fields: [{ name: "單號", type: "text" }] }),
  )
  poFormId = po.form.id

  const line = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "採購明細",
      parentFormId: poFormId,
      fields: [
        { name: "品項", type: "text" },
        { name: "金額", type: "money" },
        { name: "狀態", type: "singleSelect", options: { choices: ["待審", "已核准"] } },
      ],
    }),
  )
  lineFormId = line.form.id

  const saved1 = await records.saveWithLines(
    tenantA,
    poFormId,
    lineFormId,
    { values: { 單號: "PO-1" } },
    [
      { values: { 品項: "高麗菜", 金額: "100.00", 狀態: "已核准" } },
      { values: { 品項: "白蘿蔔", 金額: "50.00", 狀態: "待審" } },
      { values: { 品項: "蘋果", 金額: "30.00", 狀態: "已核准" } },
    ],
    ACTOR,
  )
  po1 = saved1.header.id

  const saved2 = await records.saveWithLines(
    tenantA,
    poFormId,
    lineFormId,
    { values: { 單號: "PO-2" } },
    [{ values: { 品項: "香蕉", 金額: "200.00", 狀態: "已核准" } }],
    ACTOR,
  )
  po2 = saved2.header.id
}, 120_000)

afterAll(async () => {
  await knexDestroy?.()
  await pool?.end()
  await container?.stop()
})

describe("RollupService — 子表聚合(M4)", () => {
  it("SUM 金額", async () => {
    expect(toText(await rollup.rollup(tenantA, lineFormId, po1, "金額", "SUM"))).toBe("180")
  })

  it("COUNT 子列", async () => {
    expect(toText(await rollup.rollup(tenantA, lineFormId, po1, "金額", "COUNT"))).toBe("3")
  })

  it("條件式 Rollup:只加 狀態=已核准(OQ-FML-10)", async () => {
    const v = await rollup.rollup(tenantA, lineFormId, po1, "金額", "SUM", {
      field: "狀態",
      equals: "已核准",
    })
    expect(toText(v)).toBe("130") // 100 + 30
  })

  it("MAX / AVERAGE", async () => {
    expect(toText(await rollup.rollup(tenantA, lineFormId, po1, "金額", "MAX"))).toBe("100")
    expect(toText(await rollup.rollup(tenantA, lineFormId, po1, "金額", "AVERAGE"))).toBe("60")
  })

  it("批次 Rollup(N+1 安全:一次查詢多父)", async () => {
    const m = await rollup.rollupBatch(tenantA, lineFormId, [po1, po2], "金額", "SUM")
    expect(toText(m.get(po1) ?? null)).toBe("180")
    expect(toText(m.get(po2) ?? null)).toBe("200")
  })

  it("刪子列即反映(讀時算,無 Salesforce 之刪子不重算痛點)", async () => {
    // 重存 PO-1 只留 2 行(移除 30 元那行)→ 讀時算立即反映
    await records.saveWithLines(
      tenantA,
      poFormId,
      lineFormId,
      { values: { 單號: "PO-1" }, id: po1, expectedVersion: 1 },
      [
        { values: { 品項: "高麗菜", 金額: "100.00", 狀態: "已核准" } },
        { values: { 品項: "白蘿蔔", 金額: "50.00", 狀態: "待審" } },
      ],
      ACTOR,
    )
    expect(toText(await rollup.rollup(tenantA, lineFormId, po1, "金額", "SUM"))).toBe("150")
  })
})
