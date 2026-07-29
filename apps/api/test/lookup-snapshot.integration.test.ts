import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService, SOURCE_DELETED } from "../src/form-engine/records/record.service.js"
import { RelookupService } from "../src/form-engine/relations/relookup.service.js"
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
let appKnexDestroy: () => Promise<void>
let relookup: RelookupService
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
  /* 🔴 重整走 **app 角色**車道,與 prod 同一條 —— 用 superuser 跑會把缺 grant
     這類問題整個遮住(#113 就是這樣讓 action_audit 漏 grant 一路綠到瀏覽器才爆)。 */
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  const appKnex = createDdlKnex(appUri.toString())
  appKnexDestroy = () => appKnex.destroy()
  relookup = new RelookupService(appKnex, metadata)
}, 120_000)

afterAll(async () => {
  await knexDestroy()
  await appKnexDestroy()
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


/* 🔴 #113 主體:欄位層顯式化 live / snapshot。
   §0-ter A-5 的決定性論點是**失敗不對稱** —— live 出錯是靜默改寫歷史單據且不可回復,
   snapshot 出錯只是看到舊值、按一下重整即可。故 snapshot 為建議值。 */
describe("🔴 快照帶入(syncMode=snapshot)", () => {
  async function seed(mode: "live" | "snapshot"): Promise<{
    orderFormId: number
    lookupFieldId: number
    customerFormId: number
    customerRecordId: number
    orderRecordId: number
  }> {
    const stamp = `${mode}_${String(Date.now()).slice(-6)}`
    const customer = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `客戶_${stamp}`,
        fields: [{ name: "地址", type: "text" }],
      }),
      ACTOR,
    )
    const cust = await records.createRecord(
      tenantA,
      customer.form.id,
      { 地址: "台北市舊址" },
      ACTOR,
    )
    const order = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `訂單_${stamp}`,
        fields: [
          { name: "客戶", type: "link", options: { targetFormId: customer.form.id } },
          {
            name: "送貨地址",
            type: "lookup",
            options: { linkFieldName: "客戶", targetFieldName: "地址", syncMode: mode },
          },
        ],
      }),
      ACTOR,
    )
    const ord = await records.createRecord(tenantA, order.form.id, { 客戶: cust.id }, ACTOR)
    return {
      orderFormId: order.form.id,
      lookupFieldId: order.fields.find((f) => f.name === "送貨地址")?.id ?? 0,
      customerFormId: customer.form.id,
      customerRecordId: cust.id,
      orderRecordId: ord.id,
    }
  }

  const addressOn = async (formId: number, recordId: number): Promise<unknown> =>
    (await records.getRecord(tenantA, formId, recordId)).values.送貨地址

  it("**主檔搬家後,舊單據仍是下單當時的地址**(Odoo #23756 至今未解的那個問題)", async () => {
    const s = await seed("snapshot")
    expect(await addressOn(s.orderFormId, s.orderRecordId)).toBe("台北市舊址")

    const cust = await records.getRecord(tenantA, s.customerFormId, s.customerRecordId)
    await records.updateRecord(
      tenantA,
      s.customerFormId,
      s.customerRecordId,
      cust.version,
      { 地址: "高雄市新址" },
      ACTOR,
    )
    expect(await addressOn(s.orderFormId, s.orderRecordId)).toBe("台北市舊址")
  })

  it("live 模式維持既有語意(不設 syncMode 的既有欄位零遷移)", async () => {
    const s = await seed("live")
    const cust = await records.getRecord(tenantA, s.customerFormId, s.customerRecordId)
    await records.updateRecord(
      tenantA,
      s.customerFormId,
      s.customerRecordId,
      cust.version,
      { 地址: "高雄市新址" },
      ACTOR,
    )
    expect(await addressOn(s.orderFormId, s.orderRecordId)).toBe("高雄市新址")
  })

  it("換連結對象 → 快照重取(換 parent 才重取,對齊 Quickbase)", async () => {
    const s = await seed("snapshot")
    const other = await records.createRecord(
      tenantA,
      s.customerFormId,
      { 地址: "台中市" },
      ACTOR,
    )
    const ord = await records.getRecord(tenantA, s.orderFormId, s.orderRecordId)
    await records.updateRecord(
      tenantA,
      s.orderFormId,
      s.orderRecordId,
      ord.version,
      { 客戶: other.id },
      ACTOR,
    )
    expect(await addressOn(s.orderFormId, s.orderRecordId)).toBe("台中市")
  })

  it("重整:**先給 diff 再寫**,且不寫時什麼都不動(Ragic 是無差別覆蓋)", async () => {
    const s = await seed("snapshot")
    const cust = await records.getRecord(tenantA, s.customerFormId, s.customerRecordId)
    await records.updateRecord(
      tenantA,
      s.customerFormId,
      s.customerRecordId,
      cust.version,
      { 地址: "高雄市新址" },
      ACTOR,
    )

    const dry = await relookup.relookup(tenantA, s.orderFormId, s.lookupFieldId, ACTOR, true)
    expect(dry.changed).toBe(1)
    expect(dry.applied).toBe(false)
    expect(dry.samples[0]).toMatchObject({ before: "台北市舊址", after: "高雄市新址" })
    // dry-run 不得改到任何值
    expect(await addressOn(s.orderFormId, s.orderRecordId)).toBe("台北市舊址")

    const applied = await relookup.relookup(tenantA, s.orderFormId, s.lookupFieldId, ACTOR, false)
    expect(applied.applied).toBe(true)
    expect(await addressOn(s.orderFormId, s.orderRecordId)).toBe("高雄市新址")
  })

  it("重整每筆留稽核(Ragic 此步什麼都不留)", async () => {
    const s = await seed("snapshot")
    const cust = await records.getRecord(tenantA, s.customerFormId, s.customerRecordId)
    await records.updateRecord(
      tenantA,
      s.customerFormId,
      s.customerRecordId,
      cust.version,
      { 地址: "花蓮縣" },
      ACTOR,
    )
    await relookup.relookup(tenantA, s.orderFormId, s.lookupFieldId, ACTOR, false)
    const audit = await pool.query(
      `SELECT detail FROM action_audit WHERE tenant_id = $1 AND form_id = $2 AND outcome = 'relookup'`,
      [tenantA, s.orderFormId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].detail).toMatchObject({ before: "台北市舊址", after: "花蓮縣" })
  })
})
