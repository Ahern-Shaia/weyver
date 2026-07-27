import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDdlKnex, createDrizzle, type DrizzleDb, TenantDb } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { SystemManagedFieldError } from "../src/form-engine/errors.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* R1·UP-4 M1 讀時計算虛擬欄:系統欄投影 / lookup / rollup。 */

const ACTOR = 1
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let knexDestroy: () => Promise<void>
let tenantA = 0
let custFormId = 0
let orderFormId = 0
let lineFormId = 0

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

  const cust = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "客戶",
      fields: [
        { name: "名稱", type: "text", required: true },
        { name: "電話", type: "text" },
      ],
    }),
  )
  custFormId = cust.form.id

  const order = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "訂單",
      fields: [
        { name: "單號", type: "text", required: true },
        { name: "客戶", type: "link", options: { targetFormId: custFormId } },
      ],
    }),
  )
  orderFormId = order.form.id

  const line = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "明細",
      parentFormId: orderFormId,
      fields: [
        { name: "品項", type: "text", required: true },
        { name: "數量", type: "number" },
      ],
    }),
  )
  lineFormId = line.form.id

  // 加讀時計算虛擬欄(無物理欄)
  await ddl.addField(tenantA, orderFormId, {
    name: "客戶名",
    type: "lookup",
    required: false,
    unique: false,
    options: { linkFieldName: "客戶", targetFieldName: "名稱" },
  })
  await ddl.addField(tenantA, orderFormId, {
    name: "小計",
    type: "rollup",
    required: false,
    unique: false,
    options: { childFormId: lineFormId, childFieldName: "數量", fn: "SUM" },
  })
  await ddl.addField(tenantA, orderFormId, {
    name: "建立時間",
    type: "createdAt",
    required: false,
    unique: false,
    options: {},
  })
  await ddl.addField(tenantA, orderFormId, {
    name: "建立者",
    type: "createdBy",
    required: false,
    unique: false,
    options: {},
  })
})

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

describe("R1·UP-4 讀時計算虛擬欄", () => {
  it("系統欄投影 audit + lookup 拉關聯欄", async () => {
    const cust = await records.createRecord(
      tenantA,
      custFormId,
      { 名稱: "鮮勇食品", 電話: "02-1234" },
      ACTOR,
    )
    const order = await records.createRecord(
      tenantA,
      orderFormId,
      { 單號: "SO-1", 客戶: cust.id },
      ACTOR,
    )
    const got = await records.getRecord(tenantA, orderFormId, order.id)
    expect(got.values.客戶名).toBe("鮮勇食品") // lookup
    expect(got.values.建立者).toBe(ACTOR) // system createdBy
    expect(got.values.建立時間).toMatch(/^\d{4}-\d{2}-\d{2}T/) // createdAt ISO
    // 虛擬欄無物理欄,不占 DDL:填單不含它們亦成功(上方 create 已證)
  })

  it("rollup SUM 子表數量(讀時算,無物化)", async () => {
    const order = await records.createRecord(tenantA, orderFormId, { 單號: "SO-2" }, ACTOR)
    await records.saveWithLines(
      tenantA,
      orderFormId,
      lineFormId,
      { id: order.id, expectedVersion: 1, values: { 單號: "SO-2" } },
      [{ values: { 品項: "A", 數量: 3 } }, { values: { 品項: "B", 數量: 5 } }],
      ACTOR,
    )
    const got = await records.getRecord(tenantA, orderFormId, order.id)
    expect(Number(got.values.小計)).toBe(8)
  })

  it("rollup 子列刪即反映(讀時算)", async () => {
    const order = await records.createRecord(tenantA, orderFormId, { 單號: "SO-3" }, ACTOR)
    const saved = await records.saveWithLines(
      tenantA,
      orderFormId,
      lineFormId,
      { id: order.id, expectedVersion: 1, values: { 單號: "SO-3" } },
      [{ values: { 品項: "X", 數量: 10 } }, { values: { 品項: "Y", 數量: 20 } }],
      ACTOR,
    )
    expect(Number((await records.getRecord(tenantA, orderFormId, order.id)).values.小計)).toBe(30)
    // 刪一子列 → 重算
    const keep = saved.lines[0]
    if (keep === undefined) throw new Error("no line")
    await records.saveWithLines(
      tenantA,
      orderFormId,
      lineFormId,
      { id: order.id, expectedVersion: 2, values: { 單號: "SO-3" } },
      [{ id: keep.id, values: { 品項: "X", 數量: 10 } }],
      ACTOR,
    )
    expect(Number((await records.getRecord(tenantA, orderFormId, order.id)).values.小計)).toBe(10)
  })

  it("虛擬欄 systemManaged:使用者寫入被拒", async () => {
    await expect(
      records.createRecord(tenantA, orderFormId, { 單號: "SO-4", 建立者: 99 }, ACTOR),
    ).rejects.toThrow(SystemManagedFieldError)
  })

  it("listRecords 亦注入計算值", async () => {
    const list = await records.listRecords(tenantA, orderFormId, {
      filters: [],
      sort: [],
      limit: 200,
    })
    // 每筆皆有系統欄注入
    expect(list.records.every((r) => typeof r.values.建立者 === "number")).toBe(true)
  })
})
