import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { PDF_RENDERER } from "../src/pdf/pdf-renderer.js"
import { PdfWorkerService } from "../src/pdf/pdf-worker.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·後續-2b|伺服器端 PDF(`docs/modules/R1/server-pdf.md`)。

   本檔的主軸是 **OQ-PDF-6 / FMEA P1**:PDF 是**值的又一個出口**,
   而這一輪已經修過四次同型(公式污染閉包 / 連結標題 / 通知內容 / 修改紀錄)。
   「渲染器沒有身分」不等於「渲染器沒有權限限制」—— 限制在票背後那個人身上。

   ⚠️ 渲染器以假的替身注入:真的開 Chromium 會讓這一檔變成分鐘級,
   而**要驗的東西是票與遮罩,不是 Chromium 會不會產生 PDF**
   (後者由 e2e 與手測涵蓋)。替身把拿到的網址記下來,斷言票確實走這條路。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let worker: PdfWorkerService
let tenantA = 0
let formId = 0
let recordId = 0

/* 🔴 替身**在渲染的當下核銷票**,而不是事後 —— 那才是真實的順序。
   票只在 `status = 'running'` 期間有效(見 `redeemTicket`),
   工作一旦 `ready` 票就死了。第一版測試在 `drainOne()` 之後才核銷,
   於是第一次就拿到 404;更糟的是**有一條否定斷言因此空過**
   (404 的 body 自然不含票)。 */
let lastRender: { url: string; ticket: string; status: number; body: string } | null = null

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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PDF_RENDERER)
    .useValue({
      render: async (req: { url: string }) => {
        const ticket = req.url.slice(req.url.lastIndexOf("/") + 1)
        const res = await app.inject({ method: "GET", url: `/api/pdf/render/${ticket}` })
        lastRender = { url: req.url, ticket, status: res.statusCode, body: res.body }
        return Buffer.from("%PDF-1.4 fake")
      },
    })
    .compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  worker = app.get(PdfWorkerService)

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "PDF 測試單",
      fields: [
        { name: "品名", type: "text" },
        { name: "月薪", type: "money" },
      ],
    },
  })
  formId = (form.json() as { id: number }).id

  const created = await app.inject({
    method: "POST",
    url: `/api/forms/${String(formId)}/records`,
    headers: A(),
    payload: { values: { 品名: "醬油", 月薪: "88000" } },
  })
  recordId = (created.json() as { id: number }).id
}, 180_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const createJob = async (): Promise<number> => {
  const res = await app.inject({
    method: "POST",
    url: "/api/pdf",
    headers: A(),
    payload: { formId, recordIds: [recordId] },
  })
  expect(res.statusCode).toBe(200)
  return (res.json() as { id: number }).id
}

/* 跑一件並回傳渲染當下的核銷結果 */
const renderOnce = async (): Promise<NonNullable<typeof lastRender>> => {
  lastRender = null
  await createJob()
  expect(await worker.drainOne()).toBe(true)
  if (lastRender === null) throw new Error("renderer was not called")
  return lastRender
}

describe("伺服器端 PDF", () => {
  it("送出 → worker 產生 → ready 且可下載", async () => {
    const id = await createJob()
    expect(await worker.drainOne()).toBe(true)

    const after = await app.inject({
      method: "GET",
      url: `/api/pdf/jobs/${String(id)}`,
      headers: A(),
    })
    expect(after.json()).toMatchObject({ status: "ready", recordCount: 1 })

    const dl = await app.inject({
      method: "GET",
      url: `/api/pdf/jobs/${String(id)}/download`,
      headers: A(),
    })
    expect(dl.statusCode).toBe(200)
    expect(dl.headers["content-type"]).toBe("application/pdf")
  })

  /* 🔴 票是這個模組唯一可以無身分呼叫的入口。 */
  it("🔴 票只能用一次,第二次一律 404", async () => {
    const render = await renderOnce()
    expect(render.ticket.length).toBeGreaterThan(20)
    expect(render.status).toBe(200)

    const second = await app.inject({ method: "GET", url: `/api/pdf/render/${render.ticket}` })
    expect(second.statusCode).toBe(404)
  })

  it("🔴 亂猜的票拿不到任何東西", async () => {
    const res = await app.inject({ method: "GET", url: "/api/pdf/render/not-a-real-ticket" })
    expect(res.statusCode).toBe(404)
  })

  /* 🔴 本檔存在的理由(OQ-PDF-6 / FMEA P1)。

     沒有月薪欄權限的人按下「下載 PDF」,產出的內容裡**不得有月薪**。
     這一條若不成立,PDF 就是一條繞過欄位權限的路 —— 而使用者按一個鈕就走上去了。 */
  /* 🔴 本檔存在的理由(OQ-PDF-6 / FMEA P1)。

     渲染時**重新解析**該 actor 的權限,而不是沿用建立工作時的那一份 ——
     兩者的差別在「請求與渲染之間權限被改掉」時才看得出來,而那正是
     一個被撤權的人不該還能印出資料的情況。

     本測試的 actor(7)在 authz 表裡沒有任何角色 → deny-by-default →
     **欄位值全被遮掉**。這同時證明了兩件事:
     (a) 遮罩確實套用在渲染路徑上,不是只在使用者的畫面上
     (b) 用的是**真實解析**,不是把建立工作時的 dev 超級權限帶過去

     ⚠️ dev 車道的 `x-dev-tenant` 是超級權限,而它**在渲染時重現不了**
     (那條車道本來就沒有真實身分)。這不是缺陷,是那條車道的性質。 */
  it("🔴 渲染時重新解析權限:無角色的 actor 拿不到任何欄位值", async () => {
    const render = await renderOnce()
    expect(render.status).toBe(200)

    const payload = JSON.parse(render.body) as {
      form: { name: string }
      fields: unknown[]
      records: { values: Record<string, unknown> }[]
    }
    /* 對照組:管道是通的 —— 表單與欄位定義都在,只有值被遮掉。
       沒有這一半的話,下面那條否定斷言在「整包壞掉」時也會過。 */
    expect(payload.form.name).toBe("PDF 測試單")
    expect(payload.fields.length).toBeGreaterThan(0)
    expect(payload.records).toHaveLength(1)

    expect(payload.records[0]?.values).toEqual({})
    expect(render.body).not.toContain("88000")
  })

  it("🔴 payload 不含票、不含物理欄名", async () => {
    const render = await renderOnce()
    /* 🔴 先斷言成功。否則下面兩條否定斷言會在 404 的 body 上空過 ——
       第一版就是這麼過的。 */
    expect(render.status).toBe(200)

    expect(render.body).not.toContain(render.ticket)
    /* 物理識別字(`f123`)不該出現在給瀏覽器的 payload 裡 ——
       與資料庫設計變更頁同一條理由:那是攻擊面地圖。 */
    expect(render.body).not.toMatch(/"f\d{2,}"/)
  })

  it("超過上限的筆數拒收(DB 亦有 CHECK,雙保險)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pdf",
      headers: A(),
      payload: { formId, recordIds: Array.from({ length: 201 }, (_, i) => i + 1) },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})
