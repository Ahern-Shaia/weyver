import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·FTP v1.7|文字遮罩(Ragic「文字欄位 → 文字遮罩」)。

   這個型別的**全部意義**在於遮罩發生在伺服器端。若後端回完整值、
   前端負責遮,任何人打開開發者工具就看得到 —— 那不叫遮罩叫裝飾。

   本檔逐條釘:
   1. 一般讀取路徑回的**就是**遮罩值(不是「前端會遮」)
   2. 沒有揭露權的人**拿不到**完整值
   3. 🔴 **遮罩值寫不回去** —— 一次無心的儲存會永久毀掉一筆個資 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let formId = 0
let recordId = 0
let plainActor = 0

const ADMIN = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA) })
/* 🔴 一般使用者:**沒有任何角色**。只有一位 actor 的測試表達不出授權缺口
   (`pitfall_tenant_scoped_is_not_authorized`)。 */
const PLAIN = (): Record<string, string> => ({
  "x-dev-tenant": String(tenantA),
  "x-dev-actor": String(plainActor),
  "x-dev-real-authz": "1",
})

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  tenantA =
    (
      await db
        .insert(tenants)
        .values([{ name: "廠 A" }])
        .returning()
    )[0]?.id ?? 0

  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = container.getConnectionUri()
  const { AppModule } = await import("../src/app.module.js")
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  await app.get(AuthzRepository).seedSystemRoles(tenantA)
  const [u] = await db
    .insert(users)
    .values({ authUserId: "mask-plain", email: "mask-plain@t.test", name: "一般員工" })
    .returning({ id: users.id })
  plainActor = u?.id ?? 0

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: ADMIN(),
    payload: {
      name: "個資表",
      fields: [
        { name: "姓名", type: "text" },
        { name: "身分證", type: "textMask", options: { mode: "last", keep: 4 } },
      ],
    },
  })
  formId = (form.json() as { id: number }).id

  const created = await app.inject({
    method: "POST",
    url: `/api/forms/${String(formId)}/records`,
    headers: ADMIN(),
    payload: { values: { 姓名: "王小明", 身分證: "A123456789" } },
  })
  recordId = (created.json() as { id: number }).id
}, 180_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const read = async (headers: Record<string, string>): Promise<string> => {
  const res = await app.inject({
    method: "GET",
    url: `/api/forms/${String(formId)}/records/${String(recordId)}`,
    headers,
  })
  return res.body
}

describe("文字遮罩", () => {
  /* 🔴 本檔存在的理由。 */
  it("🔴 一般讀取回的**就是**遮罩值 —— 完整值不離開伺服器", async () => {
    const body = await read(ADMIN())
    expect(body).not.toContain("A123456789")
    expect(body).toContain("6789")
    /* 對照組:別的欄位照常回,否則「不含真值」在整包壞掉時也會過 */
    expect(body).toContain("王小明")
  })

  it("🔴 列表路徑也遮(值只要有第二個出口就會漏)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/records`,
      headers: ADMIN(),
    })
    expect(res.body).not.toContain("A123456789")
    expect(res.body).toContain("6789")
  })

  /* 🔴 這一條是**真瀏覽器實走**才發現的,而且是「值的第二個出口」的第五次。

     記錄頁上半部顯示 `••••6789`,下半部的修改紀錄卻把完整值印出來 ——
     而本檔原本只驗了 `getRecord` 與 `listRecords` 兩個出口。

     **補的不是個案,是把出口列出來**:下面逐一走過每一條會吐出欄位值的路徑。 */
  it("🔴 修改紀錄也要遮(值的第五個出口)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/records/${String(recordId)}/revisions`,
      headers: ADMIN(),
    })
    expect(res.statusCode).toBe(200)
    /* 對照組:紀錄真的有內容,否則「不含真值」在空陣列上也會過 */
    expect(res.body).toContain("身分證")
    expect(res.body).not.toContain("A123456789")
  })

  /* 🔴 **列舉出口**,不是補個案。新增一條會吐出欄位值的路徑時,這一條要跟著加,
     而漏加的後果是靜默洩漏 —— 所以清單寫在這裡而不是散在各個 it 裡。

     ⚠️ 已知**還沒進這張清單**的出口(#51):PDF 渲染的 payload。
     它走 `RecordService.getRecord` 故理論上已遮,但**理論不算驗過**;
     它需要 worker 與渲染器替身,故釘在 `pdf.integration.test.ts` 較自然。 */
  it("🔴 逐一走過每個會吐出欄位值的出口", async () => {
    const outlets = [
      `/api/forms/${String(formId)}/records/${String(recordId)}`,
      `/api/forms/${String(formId)}/records`,
      `/api/forms/${String(formId)}/records/${String(recordId)}/revisions`,
      /* 全庫修改紀錄:只回「動了哪些欄」不回值,但它讀的是同一張表 —— 一起釘 */
      "/api/forms/revisions/recent",
    ]
    for (const url of outlets) {
      const res = await app.inject({ method: "GET", url, headers: ADMIN() })
      expect(res.statusCode, url).toBe(200)
      expect(res.body, `${url} 洩漏了完整值`).not.toContain("A123456789")
    }
  })

  /* 🔴 **第六個出口,而且最不明顯**。

     `SEARCHABLE` 由 registry 推導(text 欄且非 virtual),而遮罩欄兩個條件都符合
     —— 於是真值曾經被寫進全文索引。索引下去的後果不是「畫面看得到」,
     是**把身分證打進快速搜尋就能確認它存在**(value oracle),遮罩等於白做。

     ⚠️ 這一條是 #51 裡「未查證」的那一項,查了之後**確實是漏的**。 */
  it("🔴 遮罩欄不進全文索引(否則搜尋變成 value oracle)", async () => {
    const idx = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM search_doc WHERE tenant_id = $1 AND value_text ILIKE $2",
      [tenantA, "%A123456789%"],
    )
    expect(idx.rows[0]?.n).toBe(0)

    /* 對照組:同一筆記錄的**非敏感**欄確實有進索引 —— 否則「找不到」
       可能只是因為索引整個沒寫,那樣這條測試什麼都沒驗到。 */
    const control = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM search_doc WHERE tenant_id = $1 AND value_text ILIKE $2",
      [tenantA, "%王小明%"],
    )
    expect(control.rows[0]?.n).toBeGreaterThan(0)
  })

  it("admin 按眼睛看得到完整值,而且留下稽核", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/records/${String(recordId)}/reveal`,
      headers: ADMIN(),
      payload: { field: "身分證" },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { value: string }).value).toBe("A123456789")

    const audit = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM action_audit WHERE outcome = 'pii_reveal' AND record_id = $1",
      [recordId],
    )
    /* 🔴 沒有稽核的揭露等於沒有管制:看過就是看過,沒有回頭路 */
    expect(audit.rows[0]?.n).toBeGreaterThan(0)
  })

  it("🔴 沒有揭露權的人拿不到完整值", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/records/${String(recordId)}/reveal`,
      headers: PLAIN(),
      payload: { field: "身分證" },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.body).not.toContain("A123456789")
  })

  /* 🔴 這一條擋的是**資料被毀**,不是資料被看到。 */
  it("🔴 把遮罩值寫回去要被拒 —— 一次無心的儲存會永久毀掉一筆個資", async () => {
    const current = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/records/${String(recordId)}`,
      headers: ADMIN(),
    })
    const row = current.json() as { version: number; values: Record<string, unknown> }
    const maskedShown = String(row.values.身分證)

    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(formId)}/records/${String(recordId)}`,
      headers: ADMIN(),
      payload: { expectedVersion: row.version, values: { 身分證: maskedShown } },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)

    /* 真值毫髮無傷 */
    const after = await pool.query<{ v: string }>(
      `SELECT * FROM data.t${String(formId)} WHERE id = $1`,
      [recordId],
    )
    expect(JSON.stringify(after.rows[0])).toContain("A123456789")
  })

  it("重新輸入完整值可以改", async () => {
    const current = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/records/${String(recordId)}`,
      headers: ADMIN(),
    })
    const row = current.json() as { version: number }
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(formId)}/records/${String(recordId)}`,
      headers: ADMIN(),
      payload: { expectedVersion: row.version, values: { 身分證: "B222333444" } },
    })
    expect(res.statusCode).toBeLessThan(300)
  })
})
