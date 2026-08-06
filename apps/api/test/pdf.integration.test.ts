import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { PDF_RENDERER } from "../src/pdf/pdf-renderer.js"
import { PdfWorkerService } from "../src/pdf/pdf-worker.service.js"
import { STORAGE_DRIVER, type StorageDriver } from "../src/storage/storage-driver.js"
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
let storage: StorageDriver
let adminActor = 0
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
/* 系統 admin —— 渲染時解析得出真正的權限 */
const ADMIN = (): Record<string, string> => ({ ...A(), "x-dev-actor": String(adminActor) })

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

  /* 🔴 app 車道走**限權角色**,不是 superuser。
     2026-08-06:M2 的浮水印 PATCH 在此檔綠、在 dev 500 —— 因為 `tenants` 的
     UPDATE 是欄位級授權,新欄漏授權而這裡的 app 車道其實是特權連線,
     grant 一律不執法(`pitfall-privileged-lane-masks-security`,同型第六次)。
     測試綠而線上壞,正是那條 pitfall 的定義。 */
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS;
     GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = appUri.toString()
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
  storage = app.get<StorageDriver>(STORAGE_DRIVER)

  /* 🔴 兩個 actor 是刻意的:
     · actor 7 —— **沒有任何角色**,用來證明渲染時真的重新解析權限(值被遮掉)
     · `adminActor` —— 系統 admin,用來測明細等需要真的看得到資料的行為
     只有一個 actor 的測試,正是 `pitfall-tenant-scoped-is-not-authorized` 的根因。 */
  /* ⚠️ 租戶是用 drizzle 直接插的,**系統角色不會自己出現**
     (正常路徑是 `seedSystemRoles`,由租戶建立流程呼叫)。
     少了這一步,下面的指派會影響 0 列而且**不會報錯** —— actor 8 靜靜地不是 admin。 */
  await app.get(AuthzRepository).seedSystemRoles(tenantA)
  /* actor 就是 `users.id`(有外鍵),所以要先有這個人 */
  const [adminUser] = await db
    .insert(users)
    .values({ authUserId: "pdf-admin", email: "pdf-admin@t.test", name: "PDF 管理員" })
    .returning({ id: users.id })
  adminActor = adminUser?.id ?? 0
  const assigned = await pool.query(
    `INSERT INTO role_members (tenant_id, role_id, actor_id)
     SELECT $1, id, $2 FROM roles WHERE tenant_id = $1 AND is_system = true AND key = 'admin'`,
    [tenantA, adminActor],
  )
  /* 影響 0 列就是沒指派成功 —— 讓它在這裡炸掉,而不是變成一條看不懂的斷言失敗 */
  if (assigned.rowCount !== 1) throw new Error("admin role assignment failed")

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

/* 🔴 讀出替身記下的結果。**必須經一個函式**:`lastRender` 是模組層的 `let`,
   TS 的控制流分析會在 `lastRender = null` 之後把它窄化成 `null`,
   於是 `if (lastRender === null) throw` 之後型別變成 `never`。 */
function takeRender(): { url: string; ticket: string; status: number; body: string } {
  if (lastRender === null) throw new Error("renderer was not called")
  return lastRender
}

/* 跑一件並回傳渲染當下的核銷結果 */
const renderOnce = async (): Promise<NonNullable<typeof lastRender>> => {
  lastRender = null
  await createJob()
  expect(await worker.drainOne()).toBe(true)
  return takeRender()
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

  /* 🔴 產出物會長大,而且是二進位檔 —— 沒有清理就是無上限成長。 */
  it("🔴 到期後:storage 物件真的被刪,而紀錄留著標 expired", async () => {
    const id = await createJob()
    expect(await worker.drainOne()).toBe(true)

    /* 物件此刻存在。**先斷言存在**,否則下面的「已刪」會空過 */
    const before = await app.inject({
      method: "GET",
      url: `/api/pdf/jobs/${String(id)}/download`,
      headers: A(),
    })
    expect(before.statusCode).toBe(200)

    /* 🔴 先把 key 抓下來 —— 清理之後列上就沒有它了,而**「物件有沒有真的被刪」
       正是這條測試唯一擋得住那個 bug 的斷言**(見下)。 */
    const keyRow = await pool.query<{ object_key: string }>(
      "SELECT object_key FROM pdf_job WHERE id = $1",
      [id],
    )
    const key = keyRow.rows[0]?.object_key ?? ""
    expect(key).not.toBe("")
    expect(await storage.stat(key)).not.toBeNull()

    /* 把到期日推到過去,再跑清理 */
    await pool.query("UPDATE pdf_job SET expires_at = now() - interval '1 day' WHERE id = $1", [id])
    await worker.expire()

    /* 🔴 **這一行才是釘 `RETURNING` 陷阱的那一行。**

       PostgreSQL 的 `UPDATE ... RETURNING` 回的是**新值**,所以照直覺寫
       `SET object_key = NULL RETURNING object_key` 會拿到一整排 NULL,
       物件永遠刪不掉 —— 而**列仍然會被標成 expired**,看起來一切正常。

       ⚠️ 本測試的第一版只斷言了狀態與 `object_key IS NULL`,那**兩種寫法下都會過**
       —— 又一次「否定斷言空過」。真正有鑑別力的只有「物件不見了」。 */
    expect(await storage.stat(key)).toBeNull()

    const row = await pool.query<{ status: string; object_key: string | null }>(
      "SELECT status, object_key FROM pdf_job WHERE id = $1",
      [id],
    )
    expect(row.rows[0]?.status).toBe("expired")
    expect(row.rows[0]?.object_key).toBeNull()

    const after = await app.inject({
      method: "GET",
      url: `/api/pdf/jobs/${String(id)}/download`,
      headers: A(),
    })
    expect(after.statusCode).toBe(404)
  })

  /* 🔴 採購單這類單據的重點就在明細 —— 只印表頭等於沒印。 */
  it("🔴 子表明細進 payload,依 parent 分組且照 lineNo 排序", async () => {
    const parentForm = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: ADMIN(),
      payload: { name: "PDF 主檔", fields: [{ name: "單號", type: "text" }] },
    })
    const parentId = (parentForm.json() as { id: number }).id

    const childForm = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: ADMIN(),
      payload: {
        name: "PDF 明細",
        parentFormId: parentId,
        fields: [
          { name: "品項", type: "text" },
          { name: "數量", type: "number" },
        ],
      },
    })
    expect(childForm.statusCode).toBeLessThan(300)
    const childId = (childForm.json() as { id: number }).id

    const saved = await app.inject({
      method: "POST",
      url: `/api/forms/${String(parentId)}/records/save-with-lines`,
      headers: ADMIN(),
      payload: {
        childFormId: childId,
        header: { values: { 單號: "PO-001" } },
        lines: [{ values: { 品項: "乙", 數量: 2 } }, { values: { 品項: "甲", 數量: 1 } }],
      },
    })
    expect(saved.statusCode).toBeLessThan(300)
    const header = (saved.json() as { header: { id: number } }).header

    lastRender = null
    const job = await app.inject({
      method: "POST",
      url: "/api/pdf",
      headers: ADMIN(),
      payload: { formId: parentId, recordIds: [header.id] },
    })
    expect(job.statusCode).toBe(200)
    expect(await worker.drainOne()).toBe(true)
    const render = takeRender()
    expect(render.status).toBe(200)

    const payload = JSON.parse(render.body) as {
      lines: {
        form: { name: string }
        byParent: Record<string, { lineNo: number | null }[]>
      } | null
    }
    /* 對照組:明細區塊真的在(否則下面的排序斷言會在空陣列上空過) */
    expect(payload.lines?.form.name).toBe("PDF 明細")
    const rows = payload.lines?.byParent[String(header.id)] ?? []
    expect(rows).toHaveLength(2)
    /* 建立順序是 乙 → 甲,而輸出要照 lineNo 走 */
    expect(rows.map((r) => r.lineNo)).toEqual([1, 2])
  })

  it("🔴 多筆合併成一份:每一筆都在 payload 裡", async () => {
    const second = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/records`,
      headers: A(),
      payload: { values: { 品名: "米" } },
    })
    const secondId = (second.json() as { id: number }).id

    lastRender = null
    const job = await app.inject({
      method: "POST",
      url: "/api/pdf",
      headers: A(),
      payload: { formId, recordIds: [recordId, secondId] },
    })
    expect((job.json() as { recordCount: number }).recordCount).toBe(2)
    expect(await worker.drainOne()).toBe(true)
    const render = takeRender()
    expect(render.status).toBe(200)

    const payload = JSON.parse(render.body) as { records: { id: number }[] }
    expect(payload.records.map((r) => r.id).sort((a, b) => a - b)).toEqual(
      [recordId, secondId].sort((a, b) => a - b),
    )
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

  /* ── M2:版面 / 浮水印 / 附件合併 ──────────────────────────────────── */

  it("🔴 M2|版面進得了 payload —— 列印頁靠它排版,而 M1 這裡宣告成 unknown", async () => {
    const fieldId = await firstFieldId()
    const put = await app.inject({
      method: "PATCH",
      url: `/api/forms/${String(formId)}/layout`,
      headers: ADMIN(),
      payload: {
        grid: { cols: 12 },
        fields: { [String(fieldId)]: { row: 0, col: 0, colSpan: 4 } },
        statics: [],
        sections: [],
        print: { headerRows: [0], footerRows: [], pageBreakAfterRows: [1] },
      },
    })
    expect(put.statusCode).toBeLessThan(300)

    const render = await renderOnce()
    expect(render.status).toBe(200)
    const payload = JSON.parse(render.body) as {
      layout: { grid: { cols: number }; print: { headerRows: number[] } } | null
    }
    /* 這兩條在 M1 拿不到值 —— 那正是「設計器排的版 PDF 一項都不採用」的證據。 */
    expect(payload.layout?.grid.cols).toBe(12)
    expect(payload.layout?.print.headerRows).toEqual([0])
  })

  it("🔴 M2|租戶浮水印進 payload;清空即關閉", async () => {
    const patched = await app.inject({
      method: "PATCH",
      url: "/api/settings/tenant",
      headers: ADMIN(),
      payload: { pdfWatermarkText: "副本" },
    })
    expect(patched.statusCode).toBeLessThan(300)

    const render = await renderOnce()
    const payload = JSON.parse(render.body) as { watermark: { text: string | null } | null }
    expect(payload.watermark?.text).toBe("副本")

    /* 空字串在 controller 轉成 null,否則會撞 DB 的長度 CHECK 而整筆更新被拒。 */
    const cleared = await app.inject({
      method: "PATCH",
      url: "/api/settings/tenant",
      headers: ADMIN(),
      payload: { pdfWatermarkText: "" },
    })
    expect(cleared.statusCode).toBeLessThan(300)
    const after = await renderOnce()
    expect((JSON.parse(after.body) as { watermark: { text: string | null } }).watermark.text).toBe(
      null,
    )
  })

  it("🔴 M2|沒要求合併 → mergeReport 為 null;要求了但無附件 → 空陣列", async () => {
    /* 兩者混為一談的話,一張本來就沒有附件的單據會被顯示成「附件全部略過」。 */
    const plain = await app.inject({
      method: "POST",
      url: "/api/pdf",
      headers: A(),
      payload: { formId, recordIds: [recordId] },
    })
    expect(plain.statusCode).toBe(200)
    expect(await worker.drainOne()).toBe(true)
    const plainAfter = await app.inject({
      method: "GET",
      url: `/api/pdf/jobs/${String((plain.json() as { id: number }).id)}`,
      headers: A(),
    })
    expect((plainAfter.json() as { mergeReport: unknown }).mergeReport).toBe(null)

    const merged = await app.inject({
      method: "POST",
      url: "/api/pdf",
      headers: A(),
      payload: { formId, recordIds: [recordId], mergeAttachments: true },
    })
    expect(merged.statusCode).toBe(200)
    expect(await worker.drainOne()).toBe(true)
    const mergedAfter = await app.inject({
      method: "GET",
      url: `/api/pdf/jobs/${String((merged.json() as { id: number }).id)}`,
      headers: A(),
    })
    const dto = mergedAfter.json() as { status: string; mergeReport: unknown }
    expect(dto.status).toBe("ready")
    expect(dto.mergeReport).toEqual([])
  })
})

async function firstFieldId(): Promise<number> {
  const res = await app.inject({ method: "GET", url: `/api/forms/${String(formId)}`, headers: A() })
  return (res.json() as { fields: { id: number }[] }).fields[0]?.id ?? 0
}
