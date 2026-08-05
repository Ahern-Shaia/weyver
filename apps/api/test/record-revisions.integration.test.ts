import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·H-4|記錄修改紀錄(`docs/modules/R1/record-revisions.md`)。

   本檔的主軸不是「某一條路徑會不會留紀錄」,而是 **列舉所有寫入路徑**。
   這個 repo 的橫切關注點已經漏過五次(索引三次、事件兩次),每次都是
   「補了個案、下一條路徑照樣漏」—— 因為沒有任何東西在列舉出口。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let formId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }])
    .returning()
  tenantA = rows[0]?.id ?? 0

  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = container.getConnectionUri()
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "修改紀錄表",
      fields: [
        { name: "品名", type: "text" },
        { name: "數量", type: "number" },
      ],
    },
  })
  formId = (form.json() as { id: number }).id
})

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const revisions = async (
  recordId: number,
): Promise<
  {
    version: number
    action: string
    changes: { field: string; before: unknown; after: unknown }[]
  }[]
> => {
  const r = await pool.query(
    `SELECT version, action, changes FROM record_revision
       WHERE tenant_id = $1 AND form_id = $2 AND record_id = $3 ORDER BY id`,
    [tenantA, formId, recordId],
  )
  return r.rows as never
}

const create = (values: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: `/api/forms/${formId}/records`,
    headers: A(),
    payload: { values },
  })

describe("R1·H-4 記錄修改紀錄", () => {
  it("建立 → 記全部有值的欄(OQ-RV-3:視為從無到有)", async () => {
    const res = await create({ 品名: "醬油", 數量: 3 })
    const id = (res.json() as { id: number }).id
    const rows = await revisions(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.action).toBe("create")
    expect(rows[0]?.changes.map((c) => c.field).sort()).toEqual(["品名", "數量"])
    expect(rows[0]?.changes.find((c) => c.field === "品名")?.before).toBeNull()
  })

  it("🔴 更新 → 只記**真的變了**的欄", async () => {
    const created = await create({ 品名: "米", 數量: 1 })
    const row = created.json() as { id: number; version: number }
    /* 品名不動、只改數量 —— 送兩個欄,但只有一個變 */
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${String(row.id)}`,
      headers: A(),
      payload: { expectedVersion: row.version, values: { 品名: "米", 數量: 5 } },
    })
    expect(res.statusCode).toBe(200)

    const rows = await revisions(row.id)
    expect(rows).toHaveLength(2)
    const last = rows[1]
    expect(last?.action).toBe("update")
    /* 🔴 品名沒變就不該出現 —— 否則按一下儲存就多一筆「什麼都沒改」的歷史 */
    expect(last?.changes).toHaveLength(1)
    expect(last?.changes[0]?.field).toBe("數量")
    /* ⚠️ 數值欄存的是 `numeric`,DB 回來是 `1.0000000000` —— 那是引擎的內部表示。
       歷史存**原始值**是刻意的(OQ-RV-6:顯示格式會變),故這裡比數值不比字串。 */
    expect(Number(last?.changes[0]?.before)).toBe(1)
    expect(Number(last?.changes[0]?.after)).toBe(5)
  })

  it("完全沒有變動的儲存 → 不留紀錄", async () => {
    const created = await create({ 品名: "鹽", 數量: 2 })
    const row = created.json() as { id: number; version: number }
    await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${String(row.id)}`,
      headers: A(),
      payload: { expectedVersion: row.version, values: { 品名: "鹽" } },
    })
    expect(await revisions(row.id)).toHaveLength(1) // 只有建立那一筆
  })

  it("版本序號跟著記錄的 version 走(不另外發號)", async () => {
    const created = await create({ 品名: "糖" })
    const row = created.json() as { id: number; version: number }
    await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${String(row.id)}`,
      headers: A(),
      payload: { expectedVersion: row.version, values: { 品名: "冰糖" } },
    })
    const rows = await revisions(row.id)
    expect(rows.map((r) => Number(r.version))).toEqual([1, 2])
  })

  /* 🔴 這一條才是本檔存在的理由:**新增寫入路徑時它會紅**。 */
  it("🔴 每一條寫入路徑都要留紀錄(新增路徑時這條會紅)", async () => {
    const before = await pool.query(
      "SELECT count(*)::int AS n FROM record_revision WHERE tenant_id = $1 AND form_id = $2",
      [tenantA, formId],
    )
    const base = (before.rows[0] as { n: number }).n

    /* ① 單筆建立 */
    const one = await create({ 品名: "路徑1" })
    const oneRow = one.json() as { id: number; version: number }

    /* ② 批次匯入 */
    const bulk = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records/bulk`,
      headers: A(),
      payload: { rows: [{ values: { 品名: "路徑2a" } }, { values: { 品名: "路徑2b" } }] },
    })
    expect(bulk.statusCode).toBeLessThan(300)

    /* ③ 單筆更新 */
    await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${String(oneRow.id)}`,
      headers: A(),
      payload: { expectedVersion: oneRow.version, values: { 品名: "路徑1改" } },
    })

    const after = await pool.query(
      "SELECT count(*)::int AS n FROM record_revision WHERE tenant_id = $1 AND form_id = $2",
      [tenantA, formId],
    )
    /* 1 建立 + 2 匯入 + 1 更新 = 4 */
    expect((after.rows[0] as { n: number }).n - base).toBe(4)
  })
})
