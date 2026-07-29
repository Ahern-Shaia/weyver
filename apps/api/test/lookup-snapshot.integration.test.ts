import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService, SOURCE_DELETED } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 追溯稽核 #113|lookup 全部是 live → 主檔一改,去年的舊單據顯示內容被**靜默**改寫。
   深研見 field-types-parity.md §0-ter A。決定性論點是失敗不對稱:
   live 出錯不可觀察也不可修復;snapshot 出錯只是看到舊值,按一下重載即可。 */

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

/* 客戶主檔 + 訂單(link 到客戶,lookup 帶出地址)—— ERP 的經典情境 */
async function orderScenario(suffix: string): Promise<{
  customerFormId: number
  orderFormId: number
  customerId: number
  orderId: number
}> {
  const { form: customer } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: `客戶${suffix}`,
      fields: [
        { name: "客戶名稱", type: "text" },
        { name: "地址", type: "text" },
      ],
    }),
    ACTOR,
  )
  const cust = await records.createRecord(
    tenantA,
    customer.id,
    { 客戶名稱: "王先生", 地址: "台北市舊址 1 號" },
    ACTOR,
  )

  const { form: order } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: `訂單${suffix}`,
      fields: [
        { name: "單號", type: "text" },
        { name: "客戶", type: "link", options: { targetFormId: customer.id } },
        {
          name: "送貨地址",
          type: "lookup",
          options: { linkFieldName: "客戶", targetFieldName: "地址" },
        },
      ],
    }),
    ACTOR,
  )
  const ord = await records.createRecord(
    tenantA,
    order.id,
    { 單號: "SO-001", 客戶: cust.id },
    ACTOR,
  )
  return {
    customerFormId: customer.id,
    orderFormId: order.id,
    customerId: cust.id,
    orderId: ord.id,
  }
}

async function shippingAddress(orderFormId: number, orderId: number): Promise<unknown> {
  const row = await records.getRecord(tenantA, orderFormId, orderId)
  return row.values.送貨地址
}

describe("🔴 定案即固化(追溯稽核 #113)", () => {
  it("未固化時 lookup 是即時的 —— 主檔改地址,訂單跟著變(現況基準)", async () => {
    const s = await orderScenario("A")
    expect(await shippingAddress(s.orderFormId, s.orderId)).toBe("台北市舊址 1 號")

    await records.updateRecord(
      tenantA,
      s.customerFormId,
      s.customerId,
      1,
      { 地址: "新北市新址 99 號" },
      ACTOR,
    )
    expect(await shippingAddress(s.orderFormId, s.orderId)).toBe("新北市新址 99 號")
  })

  it("**固化後,客戶搬家不再改寫已定案的訂單** —— 這是 Ragic/SAP/NetSuite 的一致行為", async () => {
    const s = await orderScenario("B")
    await records.freezeComputed(tenantA, s.orderFormId, s.orderId, "approval")

    await records.updateRecord(
      tenantA,
      s.customerFormId,
      s.customerId,
      1,
      { 地址: "新北市新址 99 號" },
      ACTOR,
    )

    // 訂單仍顯示當初的地址
    expect(await shippingAddress(s.orderFormId, s.orderId)).toBe("台北市舊址 1 號")
    // 客戶主檔本身確實已更新(不是沒改到)
    const cust = await records.getRecord(tenantA, s.customerFormId, s.customerId)
    expect(cust.values.地址).toBe("新北市新址 99 號")
  })

  it("列表查詢同樣吃固化值(不只單筆讀取)", async () => {
    const s = await orderScenario("C")
    await records.freezeComputed(tenantA, s.orderFormId, s.orderId, "approval")
    await records.updateRecord(
      tenantA,
      s.customerFormId,
      s.customerId,
      1,
      { 地址: "改過了" },
      ACTOR,
    )

    const list = await records.listRecords(tenantA, s.orderFormId, {
      filters: [],
      sort: [],
      limit: 50,
    })
    expect(list.records[0]?.values.送貨地址).toBe("台北市舊址 1 號")
  })

  it("**once frozen, stays frozen** —— 重複固化不得用現在的主檔值蓋掉定案值", async () => {
    const s = await orderScenario("D")
    await records.freezeComputed(tenantA, s.orderFormId, s.orderId, "approval")
    await records.updateRecord(
      tenantA,
      s.customerFormId,
      s.customerId,
      1,
      { 地址: "第二次改的" },
      ACTOR,
    )

    await records.freezeComputed(tenantA, s.orderFormId, s.orderId, "approval")
    expect(await shippingAddress(s.orderFormId, s.orderId)).toBe("台北市舊址 1 號")
  })

  it("沒有計算欄的表:固化是 no-op(不留空快照)", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "純資料表", fields: [{ name: "備註", type: "text" }] }),
      ACTOR,
    )
    const r = await records.createRecord(tenantA, form.id, { 備註: "x" }, ACTOR)
    await records.freezeComputed(tenantA, form.id, r.id, "approval")

    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM record_snapshot WHERE form_id = $1",
      [form.id],
    )
    expect((rows[0] as { n: number }).n).toBe(0)
  })
})

describe("🔴 lookup 來源被刪除要看得出來(追溯稽核 #113)", () => {
  it("**來源記錄被刪 → 標記而非靜默變 null** —— 後者在單據上等同資料遺失", async () => {
    const s = await orderScenario("E")
    await records.softDeleteRecord(tenantA, s.customerFormId, s.customerId, ACTOR)

    expect(await shippingAddress(s.orderFormId, s.orderId)).toBe(SOURCE_DELETED)
  })

  it("沒連結客戶的訂單仍是 null(「沒填」與「來源不見了」要分得開)", async () => {
    const s = await orderScenario("F")
    const bare = await records.createRecord(tenantA, s.orderFormId, { 單號: "SO-空" }, ACTOR)
    expect(await shippingAddress(s.orderFormId, bare.id)).toBeNull()
  })

  it("已固化的記錄不受來源刪除影響 —— 這正是 snapshot 的價值", async () => {
    const s = await orderScenario("G")
    await records.freezeComputed(tenantA, s.orderFormId, s.orderId, "approval")
    await records.softDeleteRecord(tenantA, s.customerFormId, s.customerId, ACTOR)

    expect(await shippingAddress(s.orderFormId, s.orderId)).toBe("台北市舊址 1 號")
  })
})
