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

/* 🔴 R1·H-4 v1.2|**資料庫設計變更**(Ragic 官方 `doc/81`:同一頁的下半部)。 */
describe("資料庫設計變更", () => {
  const changes = async (): Promise<Record<string, unknown>[]> => {
    const res = await app.inject({
      method: "GET",
      url: "/api/forms/revisions/design-changes",
      headers: A(),
    })
    expect(res.statusCode).toBe(200)
    return (res.json() as { changes: Record<string, unknown>[] }).changes
  }

  it("建表與加欄都看得到,且標示是哪張表單", async () => {
    const add = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/fields`,
      headers: A(),
      payload: { name: "備註", type: "text" },
    })
    expect(add.statusCode).toBeLessThan(300)

    const rows = await changes()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.formId === formId && r.formName === "修改紀錄表")).toBe(true)
  })

  /* 🔴 本檔這一段存在的理由。物理識別字(`t123` / `f456`)與完整 DDL 語句
     不得離開後端 —— 攤在畫面上等於奉送一份動態 identifier 注入的地圖。 */
  it("🔴 回應裡沒有 executed_sql,也沒有任何物理識別字", async () => {
    const rows = await changes()
    const body = JSON.stringify(rows)
    expect(body).not.toMatch(/executedSql|executed_sql/)
    expect(body).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
    /* 物理表名 / 欄名的形狀 —— metadata catalog 用 `t<id>` / `f<id>` */
    expect(body).not.toMatch(/\bt\d{2,}\b|\bf\d{2,}\b/)
  })
})

/* 🔴 R1·H-4 v1.2|**批次還原**(`docs/modules/R1/record-revisions.md` §7)。
   Ragic 官方 `doc/81`:「點擊該筆修改或匯入紀錄旁的還原符號來復原修改前的資料。」 */
describe("批次還原", () => {
  let undoFormId = 0

  const rows = async (): Promise<Record<string, unknown>[]> => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${String(undoFormId)}/records`,
      headers: A(),
    })
    return (res.json() as { records: Record<string, unknown>[] }).records
  }

  const batches = async (): Promise<Record<string, unknown>[]> => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/revisions/recent?formId=${String(undoFormId)}`,
      headers: A(),
    })
    return (res.json() as { batches: Record<string, unknown>[] }).batches
  }

  const undo = async (batchId: number): Promise<ReturnType<typeof app.inject>> =>
    app.inject({
      method: "POST",
      url: `/api/forms/revisions/batches/${String(batchId)}/undo`,
      headers: A(),
    })

  beforeAll(async () => {
    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: "批次還原表",
        fields: [
          { name: "品名", type: "text" },
          { name: "數量", type: "number" },
        ],
      },
    })
    undoFormId = (form.json() as { id: number }).id
  })

  it("匯入的批次折成一列,標示筆數且可還原", async () => {
    const bulk = await app.inject({
      method: "POST",
      url: `/api/forms/${String(undoFormId)}/records/bulk`,
      headers: A(),
      payload: { rows: [{ values: { 品名: "甲" } }, { values: { 品名: "乙" } }] },
    })
    expect(bulk.statusCode).toBeLessThan(300)

    const list = await batches()
    const b = list[0] as { id: number; kind: string; recordCount: number; undoable: boolean }
    expect(b.kind).toBe("import")
    /* Ragic 折成一列並寫「N 筆資料」—— 筆數是 distinct 記錄數 */
    expect(b.recordCount).toBe(2)
    expect(b.undoable).toBe(true)

    /* 🔴 批次的列不得同時又逐筆出現在修改紀錄裡,否則匯入 5000 筆會把整頁淹掉 */
    const recent = await app.inject({
      method: "GET",
      url: `/api/forms/revisions/recent?formId=${String(undoFormId)}`,
      headers: A(),
    })
    expect((recent.json() as { revisions: unknown[] }).revisions).toHaveLength(0)

    const res = await undo(b.id)
    expect(res.statusCode).toBe(200)
    expect((res.json() as { undoneRecords: number }).undoneRecords).toBe(2)
    /* 匯入的還原 = 那些記錄本來不存在 → 軟刪 */
    expect(await rows()).toHaveLength(0)

    /* 🔴 還原完不得留下一列「0 筆」的空批次。匯入的還原是軟刪,而軟刪不寫
       修改紀錄(它記在回收桶)—— 那個批次會是空的,列出來就是一個
       按下去什麼都不會發生的還原鈕。「被還原過」由原批次自己標。 */
    const after = await batches()
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ kind: "import", undoable: false })
    expect(after[0]?.undoneAt).not.toBeNull()
  })

  it("還原過的批次不能再還原一次", async () => {
    await app.inject({
      method: "POST",
      url: `/api/forms/${String(undoFormId)}/records/bulk`,
      headers: A(),
      payload: { rows: [{ values: { 品名: "丙" } }] },
    })
    const b = (await batches())[0] as { id: number }
    expect((await undo(b.id)).statusCode).toBe(200)
    expect((await undo(b.id)).statusCode).toBeGreaterThanOrEqual(400)
  })

  it("貼上批次還原後回到修改前的值", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/forms/${String(undoFormId)}/records`,
      headers: A(),
      payload: { values: { 品名: "原值", 數量: 1 } },
    })
    const row = created.json() as { id: number }

    const paste = await app.inject({
      method: "POST",
      url: `/api/forms/${String(undoFormId)}/records/bulk-update`,
      headers: A(),
      payload: { rows: [{ recordId: row.id, values: { 品名: "貼上值", 數量: 99 } }] },
    })
    expect(paste.statusCode).toBe(200)

    const b = (await batches()).find((x) => x.kind === "paste") as { id: number }
    expect((await undo(b.id)).statusCode).toBe(200)

    const after = (await rows()).find((r) => Number(r.id) === row.id)
    expect(after?.values).toMatchObject({ 品名: "原值" })
  })

  /* 🔴 本檔這一段存在的理由(OQ-RV-10 / FMEA B1)。

     Ragic 官方限制 3 只寫「不建議還原很久以前的大量修改」,不擋 ——
     照還原會把別人後來的工作**銷毀**。這條釘住:動過的那一格不還原,而且會回報。 */
  it("🔴 貼上之後別人又改過的那一格不還原,並回報跳過", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/forms/${String(undoFormId)}/records`,
      headers: A(),
      payload: { values: { 品名: "起點", 數量: 1 } },
    })
    const row = created.json() as { id: number }

    await app.inject({
      method: "POST",
      url: `/api/forms/${String(undoFormId)}/records/bulk-update`,
      headers: A(),
      payload: { rows: [{ recordId: row.id, values: { 品名: "貼上", 數量: 50 } }] },
    })
    const b = (await batches()).find((x) => x.kind === "paste") as { id: number }

    /* 貼上之後,有人手動把「品名」再改掉 —— 這一格不屬於那次貼上了 */
    const current = (await rows()).find((r) => Number(r.id) === row.id) as { version: number }
    await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(undoFormId)}/records/${String(row.id)}`,
      headers: A(),
      payload: { expectedVersion: current.version, values: { 品名: "同事後來寫的" } },
    })

    const res = await undo(b.id)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { skipped: { field: string | null; reason: string }[] }
    expect(body.skipped.some((s) => s.field === "品名")).toBe(true)

    const after = (await rows()).find((r) => Number(r.id) === row.id)
    /* 同事的字還在(沒被還原蓋掉),而沒人動過的數量回到 1 */
    expect(after?.values).toMatchObject({ 品名: "同事後來寫的" })
    expect(Number((after?.values as { 數量: unknown }).數量)).toBe(1)
  })

  /* 🔴 GUC 是連線層狀態,連線池會重用 —— 沒清乾淨的話,匯入之後的一筆單筆編輯
     會被歸進那次匯入的批次,於是「還原那次匯入」會順手還原一筆無關的修改。 */
  it("🔴 批次之後的單筆編輯不得被歸進該批次", async () => {
    await app.inject({
      method: "POST",
      url: `/api/forms/${String(undoFormId)}/records/bulk`,
      headers: A(),
      payload: { rows: [{ values: { 品名: "批次內" } }] },
    })
    const b = (await batches())[0] as { id: number; recordCount: number }
    expect(b.recordCount).toBe(1)

    const solo = await app.inject({
      method: "POST",
      url: `/api/forms/${String(undoFormId)}/records`,
      headers: A(),
      payload: { values: { 品名: "批次外" } },
    })
    expect(solo.statusCode).toBeLessThan(300)

    const again = (await batches()).find((x) => x.id === b.id) as { recordCount: number }
    expect(again.recordCount).toBe(1)
  })
})
