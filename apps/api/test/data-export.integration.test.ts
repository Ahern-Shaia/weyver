import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { ExportRepository } from "../src/export/export.repository.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

const run = promisify(execFile)

/* 🔴 R1·I-1 M1|匯出工作佇列。

   本檔釘住的是**出事才會發現**的性質:
   · 跨租戶讀不到(RLS 執法,不是服務層記得加 WHERE)
   · app 車道**改不動**自己那一列的狀態(狀態只由 worker 推進)
   · 同一租戶同時只有一個進行中(DB 唯一索引,不是應用層先查再寫)
   · 認領是原子的(兩個 worker 不會撿到同一列)

   🔴 一律走 **app 車道**(NOSUPERUSER / NOBYPASSRLS)—— 用特權連線測 RLS 等於沒測。
   本專案已經因為這件事踩過七次。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let appPool: pg.Pool
let repo: ExportRepository
let tenantA = 0
let tenantB = 0
let actorA = 0
let actorB = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri())
  await runMigrations(pool)
  const db = createDrizzle(pool)

  const t = await db
    .insert(tenants)
    .values([{ name: "甲廠" }, { name: "乙廠" }])
    .returning()
  tenantA = t[0]?.id ?? 0
  tenantB = t[1]?.id ?? 0
  const u = await db
    .insert(users)
    .values([
      { authUserId: "ex-admin", email: "ex@weyver.test", name: "管理員" },
      /* 🔴 同租戶的**另一個人**。原測試只有一位 actor,於是「同租戶跨 actor」
         這條路徑從來沒被測過 —— 而漏掉的正是那裡。 */
      { authUserId: "ex-member", email: "ex2@weyver.test", name: "一般成員" },
    ])
    .returning()
  actorA = u[0]?.id ?? 0
  actorB = u[1]?.id ?? 0

  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  appPool = testPool(appUri.toString())

  /* repo 的兩條車道刻意用**不同連線**:特權(worker)走 pool、app 走 appPool */
  repo = new ExportRepository(db, new TenantDb(createDrizzle(appPool)))
}, 180_000)

afterAll(async () => {
  await appPool?.end()
  await pool?.end()
  await container?.stop()
})

const reset = async (): Promise<void> => {
  await pool.query("DELETE FROM export_job")
}

describe("🔴 建立與查詢", () => {
  it("建立後查得到,狀態為 queued", async () => {
    await reset()
    const job = await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    expect(job.status).toBe("queued")
    const list = await repo.listForActor(tenantA, actorA)
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(job.id)
  })

  /* 🔴🔴 P0(2026-08-03 稽核發現,已出貨):**同租戶、不同人**也不得讀到。

     原本三支讀取端(list / get / claimDownload)**只綁 `tenant_id`**。
     而封存檔是以**建立者的權限**產生的 —— admin 的匯出含全租戶資料 ——
     於是同租戶任一成員可 `GET /api/exports` 取到別人的 job id、再下載整包,
     等於任何已登入成員都能取走整個租戶的資料。

     為什麼沒被抓到:既有測試只覆蓋**跨租戶**(RLS 會擋),
     而 RLS 的粒度是租戶,擋不住同租戶跨人。**下載端點的 `@SelfService()`
     又讓它跳過 admin 守衛,再認證驗的是呼叫者自己的密碼 ——
     那證明的是「你是你」,不是「這包是你的」。**

     AGENTS 資安鐵則 2:每查詢綁 `tenant_id` **且**驗此人能存取「這個 ID」(BOLA)。 */
  it("🔴 同租戶但不是本人 —— 讀不到、也認領不到下載", async () => {
    await reset()
    const job = await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    await pool.query(
      `UPDATE export_job SET status='ready', object_key='k', expires_at=now()+interval '1 day' WHERE id=$1`,
      [job.id],
    )

    expect(await repo.listForActor(tenantA, actorB)).toHaveLength(0)
    expect(await repo.getForActor(tenantA, actorB, job.id)).toBeNull()
    /* 最關鍵的一條:即使拿到了 id,也認領不到檔案 */
    expect(await repo.claimDownload(tenantA, actorB, job.id, 3)).toBeNull()
    /* 本人仍然可以 —— 修正不得把功能一起關掉 */
    expect(await repo.claimDownload(tenantA, actorA, job.id, 3)).not.toBeNull()
  })

  it("🔴 跨租戶讀不到 —— RLS 執法,不靠服務層記得加 WHERE", async () => {
    await reset()
    const job = await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    expect(await repo.listForActor(tenantB, actorA)).toHaveLength(0)
    expect(await repo.getForActor(tenantB, actorA, job.id)).toBeNull()
  })

  /* 🔴 同時只允許一個進行中(OQ-EX-8=A)。寫成部分唯一索引而非應用層檢查 ——
     兩個請求同時進來時「先查再寫」擋不住。 */
  it("🔴 同一租戶不得同時有兩個進行中", async () => {
    await reset()
    await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    await expect(
      repo.create({ tenantId: tenantA, actorId: actorA, formIds: null, includeAttachments: false }),
    ).rejects.toThrow()
    /* 但別的租戶不受影響 —— 索引是 per-tenant */
    await expect(
      repo.create({ tenantId: tenantB, actorId: actorA, formIds: null, includeAttachments: false }),
    ).resolves.toBeDefined()
  })
})

describe("🔴 app 車道的權限邊界(DB 層執法,非程式碼自律)", () => {
  it("🔴 使用者改不動自己那一列的狀態", async () => {
    await reset()
    const job = await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    const client = await appPool.connect()
    try {
      await client.query("BEGIN")
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantA)])
      /* 自己把自己標成 ready + 延長到期 = 繞過整套限制。GRANT 不給 UPDATE 就沒這回事。 */
      await expect(
        client.query(`UPDATE export_job SET status = 'ready' WHERE id = $1`, [job.id]),
      ).rejects.toThrow(/permission denied/i)
      await client.query("ROLLBACK")
    } finally {
      client.release()
    }
  })

  it("🔴 使用者刪不掉紀錄 —— 誰帶走了整包資料必須留得下來", async () => {
    await reset()
    const job = await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    const client = await appPool.connect()
    try {
      await client.query("BEGIN")
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantA)])
      await expect(client.query("DELETE FROM export_job WHERE id = $1", [job.id])).rejects.toThrow(
        /permission denied/i,
      )
      await client.query("ROLLBACK")
    } finally {
      client.release()
    }
  })
})

describe("🔴 worker 認領", () => {
  it("認領後狀態為 running,且同一列不會被認領兩次", async () => {
    await reset()
    await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    const first = await repo.claimNext()
    expect(first?.status).toBe("running")
    /* 🔴 型別轉換:原生 pg 回 snake_case + bigint 字串。沒轉的話這一條會是 NaN */
    expect(first?.tenantId).toBe(tenantA)
    expect(Number.isSafeInteger(first?.id ?? Number.NaN)).toBe(true)

    expect(await repo.claimNext()).toBeNull()
  })

  it("沒有工作時回 null,不丟例外", async () => {
    await reset()
    expect(await repo.claimNext()).toBeNull()
  })

  it("失敗訊息寫得回去", async () => {
    await reset()
    await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    const job = await repo.claimNext()
    await repo.markFailed(job?.id ?? 0, "資料量超過單次匯出上限")
    const after = await repo.getForActor(tenantA, actorA, job?.id ?? 0)
    expect(after?.status).toBe("failed")
    expect(after?.error).toContain("上限")
  })
})

describe("🔴 到期", () => {
  it("🔴 到期清掉 storage key 但**列留著** —— 稽核要答得出誰帶走了資料", async () => {
    await reset()
    await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    const job = await repo.claimNext()
    const id = job?.id ?? 0
    await repo.markReady(id, {
      objectKey: `exports/${String(tenantA)}/${String(id)}.zip`,
      sizeBytes: 100,
      rowCount: 3,
      expiresAt: new Date(Date.now() - 1_000),
    })

    const due = await repo.expireDue(new Date())
    expect(due).toHaveLength(1)
    expect(due[0]?.objectKey).toContain(".zip")

    const after = await repo.getForActor(tenantA, actorA, id)
    expect(after).not.toBeNull()
    expect(after?.status).toBe("expired")
    expect(after?.objectKey).toBeNull()
    /* 誰請求的、什麼時候 —— 這兩個欄位是留著的理由 */
    expect(after?.requestedByActorId).toBe(actorA)
  })

  it("未到期的不動", async () => {
    await reset()
    await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    const job = await repo.claimNext()
    await repo.markReady(job?.id ?? 0, {
      objectKey: "exports/x.zip",
      sizeBytes: 1,
      rowCount: 1,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    expect(await repo.expireDue(new Date())).toHaveLength(0)
  })
})

describe("環境前提", () => {
  it("unzip 可用(封存檔的驗證仰賴它)", async () => {
    const { stdout } = await run("unzip", ["-v"]).catch(() => ({ stdout: "" }))
    expect(stdout.length).toBeGreaterThan(0)
  })
})

/* 🔴 端到端:真表單 → 真記錄 → 真 zip。

   前面的測試只驗佇列的狀態機;這一段驗**產出物本身**。
   「匯出跑完了、檔案也產生了,但裡面少了一張表」是這個模組最貴的失效,
   而它只有把 zip 解開來看才會發現。 */
describe("🔴 端到端:runner 產出的封存檔", () => {
  it("🔴 含全部有權表單的記錄,且無權的表**整張不出現**", async () => {
    const { FastifyAdapter } = await import("@nestjs/platform-fastify")
    type FastifyApp = import("@nestjs/platform-fastify").NestFastifyApplication
    const { Test } = await import("@nestjs/testing")
    const { mkdtemp } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")

    const uri = container.getConnectionUri()
    const storageDir = await mkdtemp(join(tmpdir(), "weyver-export-store-"))
    process.env.STORAGE_LOCAL_DIR = storageDir
    process.env.DATABASE_URL = uri
    process.env.APP_DATABASE_URL = uri

    const { AppModule } = await import("../src/app.module.js")
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    const app = moduleRef.createNestApplication<FastifyApp>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    try {
      const H = { "x-dev-tenant": String(tenantA), "x-dev-actor": String(actorA) }
      const form = await app.inject({
        method: "POST",
        url: "/api/forms",
        headers: H,
        payload: {
          name: "匯出用採購單",
          fields: [
            { name: "品名", type: "text", required: true },
            { name: "金額", type: "number" },
          ],
        },
      })
      const formId = (form.json() as { id: number }).id
      for (const name of ["麵粉", "砂糖", "=SUM(A1)"]) {
        await app.inject({
          method: "POST",
          url: `/api/forms/${String(formId)}/records`,
          headers: H,
          payload: { values: { 品名: name, 金額: 10 } },
        })
      }

      /* 🔴 第二張表由**別人**建立且未授權給 actorA —— 匯出必須整張跳過。
         這才是「匯出是欄位級權限的第 17 條旁路」那句話的實際檢查:
         上一張表 actorA 是建立者(owner 短路)才通過的,不能拿它當通過的證據。 */
      const other = await app.inject({
        method: "POST",
        url: "/api/forms",
        headers: { "x-dev-tenant": String(tenantA), "x-dev-actor": "999" },
        payload: { name: "他人的機密表", fields: [{ name: "內容", type: "text" }] },
      })
      expect(other.statusCode).toBe(201)

      await reset()
      await repo.create({
        tenantId: tenantA,
        actorId: actorA,
        formIds: null,
        includeAttachments: false,
      })

      const { ExportWorkerService } = await import("../src/export/export-worker.service.js")
      const worker = app.get(ExportWorkerService)
      expect(await worker.drainOne()).toBe(true)

      const jobs = await repo.listForActor(tenantA, actorA)
      const job = jobs[0]
      expect(job?.status).toBe("ready")
      expect(job?.rowCount).toBe(3)

      /* 解開來看 —— 不看我方自己記的 rowCount,那只證明我方的計數器 */
      const objectPath = join(storageDir, job?.objectKey ?? "")
      const { stdout } = await run("unzip", ["-p", objectPath, "manifest.json"])
      const manifest = JSON.parse(stdout) as { forms: { file: string; name: string }[] }
      /* 🔴 只有自己有權的那一張。無權的表**連名字都不該出現在 manifest 裡** ——
         出一個空 CSV 等於洩漏「這張表存在」以及它的欄位名。 */
      expect(manifest.forms.map((f) => f.name)).toEqual(["匯出用採購單"])

      const csv = await run("unzip", ["-p", objectPath, manifest.forms[0]?.file ?? ""])
      expect(csv.stdout).toContain("麵粉")
      expect(csv.stdout).toContain("砂糖")
      /* 🔴 使用者當初合法填進去的公式字串,在產出的 CSV 裡必須已被跳脫 */
      expect(csv.stdout).toContain("'=SUM(A1)")
    } finally {
      await app.close()
    }
  }, 180_000)
})

/* 🔴 M2|端點。最關鍵的一條是**停權租戶仍請求得到匯出** ——
   `TenantGuard` 對唯讀租戶擋掉所有 POST,而請求匯出正是 POST。
   不豁免的話,本模組上線後停權客戶依然拿不到資料,而那是它存在的第一個理由。 */
describe("🔴 M2 端點", () => {
  let app: import("@nestjs/platform-fastify").NestFastifyApplication
  const H = (): Record<string, string> => ({
    "x-dev-tenant": String(tenantA),
    "x-dev-actor": String(actorA),
  })

  beforeAll(async () => {
    const { FastifyAdapter } = await import("@nestjs/platform-fastify")
    const { Test } = await import("@nestjs/testing")
    const { mkdtemp } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    process.env.STORAGE_LOCAL_DIR = await mkdtemp(join(tmpdir(), "weyver-export-m2-"))
    process.env.DATABASE_URL = container.getConnectionUri()
    process.env.APP_DATABASE_URL = container.getConnectionUri()
    const { AppModule } = await import("../src/app.module.js")
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<typeof app>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  }, 180_000)

  afterAll(async () => {
    await app?.close()
  })

  /* 🔴 RFC 9110 §15.3.3:「the request has been accepted for processing, but the
     processing has not been completed」—— 回 201「已建立」會誤導,
     使用者真正在意的封存檔那時候還不存在。 */
  it("🔴 POST 回 202 Accepted,且帶得回可輪詢的工作資源", async () => {
    await reset()
    const res = await app.inject({ method: "POST", url: "/api/exports", headers: H(), payload: {} })
    expect(res.statusCode).toBe(202)
    const job = res.json() as { id: number; status: string; downloadsLeft: number }
    expect(job.status).toBe("queued")
    expect(job.downloadsLeft).toBe(5)

    const one = await app.inject({
      method: "GET",
      url: `/api/exports/${String(job.id)}`,
      headers: H(),
    })
    expect(one.statusCode).toBe(200)
  })

  it("🔴 停權(唯讀)租戶仍請求得到匯出 —— 那是停權訊息裡逐字承諾的事", async () => {
    await reset()
    await pool.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [tenantA])
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/exports",
        headers: H(),
        payload: {},
      })
      expect(res.statusCode).toBe(202)

      /* 但其他寫入照擋 —— 豁免的是匯出,不是「停權時什麼都能做」 */
      const write = await app.inject({
        method: "POST",
        url: "/api/forms",
        headers: H(),
        payload: { name: "停權時不該建得起來", fields: [{ name: "x", type: "text" }] },
      })
      expect(write.statusCode).toBe(403)
      expect((write.json() as { code: string }).code).toBe("TENANT_READ_ONLY")
    } finally {
      await pool.query("UPDATE tenants SET status = 'active' WHERE id = $1", [tenantA])
    }
  })

  it("🔴 已有一個在跑時回 409,而不是資料庫約束錯誤", async () => {
    await reset()
    await app.inject({ method: "POST", url: "/api/exports", headers: H(), payload: {} })
    const second = await app.inject({
      method: "POST",
      url: "/api/exports",
      headers: H(),
      payload: {},
    })
    expect(second.statusCode).toBe(409)
    expect((second.json() as { code: string }).code).toBe("EXPORT_ALREADY_RUNNING")
  })

  /* 空陣列與「不指定」是兩回事:前者是「一張都不要」,那不是匯出。
     靜默當成「全部」會讓使用者拿到他沒打算要的整包資料。 */
  it("🔴 formIds 給空陣列 → 明確拒絕,不靜默當成全部", async () => {
    await reset()
    const res = await app.inject({
      method: "POST",
      url: "/api/exports",
      headers: H(),
      payload: { formIds: [] },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { code: string }).code).toBe("EXPORT_EMPTY_SCOPE")
  })

  /* 🔴 每日上限擋的是**接力**:跑完立刻再送一次,就能讓匯出無限地把整個租戶
     掃一遍又一遍。「同時只有一個」擋不到這個。 */
  it("🔴 達每日上限後拒絕,訊息說得出還能怎麼辦", async () => {
    await reset()
    /* 直接以特權車道塞 10 筆**已完成**的今日紀錄 —— 走 API 會被「同時一個」擋住 */
    for (let i = 0; i < 10; i += 1) {
      await pool.query(
        `INSERT INTO export_job (tenant_id, requested_by_actor_id, status) VALUES ($1, $2, 'ready')`,
        [tenantA, actorA],
      )
    }
    const res = await app.inject({ method: "POST", url: "/api/exports", headers: H(), payload: {} })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { code: string; message: string }
    expect(body.code).toBe("EXPORT_DAILY_LIMIT")
    expect(body.message).toContain("明天")

    /* 別的租戶不受影響 —— 上限是 per-tenant */
    const other = await app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { "x-dev-tenant": String(tenantB), "x-dev-actor": String(actorA) },
      payload: {},
    })
    expect(other.statusCode).toBe(202)
  })

  it("🔴 跨租戶讀不到別人的匯出", async () => {
    await reset()
    const res = await app.inject({ method: "POST", url: "/api/exports", headers: H(), payload: {} })
    const id = (res.json() as { id: number }).id
    const other = await app.inject({
      method: "GET",
      url: `/api/exports/${String(id)}`,
      headers: { "x-dev-tenant": String(tenantB), "x-dev-actor": String(actorA) },
    })
    expect(other.statusCode).toBe(404)
  })
})

/* 🔴 M3|下載。三件事各自出事的方式不同:
   · 次數沒有原子遞增 → 兩個分頁同時按就能各下載一次,上限形同虛設
   · 到期沒清 → 整包公司資料無限期躺在儲存體上
   · 到期把列也刪掉 → 稽核答不出「誰帶走了資料」 */
describe("🔴 M3 下載", () => {
  let app: import("@nestjs/platform-fastify").NestFastifyApplication
  let storageDir = ""
  const H = (): Record<string, string> => ({
    "x-dev-tenant": String(tenantA),
    "x-dev-actor": String(actorA),
  })

  beforeAll(async () => {
    const { FastifyAdapter } = await import("@nestjs/platform-fastify")
    const { Test } = await import("@nestjs/testing")
    const { mkdtemp } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    storageDir = await mkdtemp(join(tmpdir(), "weyver-export-m3-"))
    process.env.STORAGE_LOCAL_DIR = storageDir
    process.env.DATABASE_URL = container.getConnectionUri()
    process.env.APP_DATABASE_URL = container.getConnectionUri()
    const { AppModule } = await import("../src/app.module.js")
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication<typeof app>(new FastifyAdapter())
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    /* 🔴 **向 app 問它實際用的目錄**,不要假設等於我剛設的那個環境變數。
       同一個 process 內先前已建過 app,env 在那時就被讀進 ConfigModule ——
       照自己設的路徑寫檔案,會寫到一個沒有人會去讀的地方(實測 ENOENT)。 */
    const { ConfigService } = await import("@nestjs/config")
    storageDir = app.get(ConfigService).get<string>("STORAGE_LOCAL_DIR") ?? storageDir
  }, 180_000)

  afterAll(async () => {
    await app?.close()
  })

  /* 建一個 ready 的工作 + 一個真的檔案。走 worker 產生太慢,
     這裡要驗的是**下載**那一段。 */
  const seedReady = async (opts: { downloads?: number; expiresInMs?: number } = {}) => {
    await reset()
    const { writeFile, mkdir } = await import("node:fs/promises")
    const { dirname, join } = await import("node:path")
    const key = `t${String(tenantA)}/exports/00000000-0000-4000-8000-00000000000a.zip`
    const full = join(storageDir, key)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, Buffer.from("PK\u0003\u0004fake-zip"))
    const res = await pool.query<{ id: string }>(
      `INSERT INTO export_job
         (tenant_id, requested_by_actor_id, status, object_key, size_bytes, row_count,
          download_count, ready_at, expires_at)
       VALUES ($1, $2, 'ready', $3, 10, 3, $4, now(), now() + ($5 || ' milliseconds')::interval)
       RETURNING id`,
      [tenantA, actorA, key, opts.downloads ?? 0, String(opts.expiresInMs ?? 86_400_000)],
    )
    return Number(res.rows[0]?.id ?? 0)
  }

  const download = (id: number) =>
    app.inject({
      method: "POST",
      url: `/api/exports/${String(id)}/download`,
      headers: H(),
      payload: {},
    })

  it("下載得到封存檔,且次數遞增", async () => {
    const id = await seedReady()
    const res = await download(id)
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toContain("zip")
    /* 🔴 一律 no-store:這是一份整包公司資料,不得被任何快取層留存 */
    expect(String(res.headers["cache-control"])).toContain("no-store")

    const after = await repo.getForActor(tenantA, actorA, id)
    expect(after?.downloadCount).toBe(1)
  })

  /* 🔴 M4 修正的形狀:driver 能簽名時,回的是 **200 JSON `{url}`** 而不是 302。

     這條路徑在 dev 與其餘測試裡永遠不會執行(local driver 沒有 `presign`),
     所以它原本是「測試永遠綠、只有 prod 會壞」—— 302 對 curl 成立,但前端只能用
     `fetch`(POST 要帶密碼),而 fetch 跟隨重導後最終回應仍須通過 CORS 檢查,
     物件儲存桶預設不會給。這裡臨時給 local driver 補一個 `presign` 來走那一半。 */
  it("🔴 driver 能簽名時回 JSON 而非重導(prod 才會走到的分支)", async () => {
    const id = await seedReady()
    const { STORAGE_DRIVER } = await import("../src/storage/storage-driver.js")
    const driver = app.get<{ presign?: unknown }>(STORAGE_DRIVER)
    driver.presign = (key: string, opts: { filename: string }) =>
      Promise.resolve(`https://storage.example.com/${key}?sig=x&name=${opts.filename}`)
    try {
      const res = await download(id)
      expect(res.statusCode).toBe(200)
      expect(res.headers.location).toBeUndefined()
      expect((res.json() as { url: string }).url).toContain("https://storage.example.com/")
      expect(String(res.headers["cache-control"])).toContain("no-store")
      /* 交出簽名 URL 也算一次下載 —— 否則限次可被「只取 URL 不取檔」繞過 */
      expect((await repo.getForActor(tenantA, actorA, id))?.downloadCount).toBe(1)
    } finally {
      driver.presign = undefined
    }
  })

  /* 🔴 原子性。先查再寫的話,兩個同時進來的請求會各自看到「還剩 1 次」。 */
  it("🔴 併發下載不得突破次數上限", async () => {
    const id = await seedReady({ downloads: 4 })
    const results = await Promise.all([download(id), download(id), download(id)])
    const ok = results.filter((r) => r.statusCode === 200)
    expect(ok).toHaveLength(1)

    const after = await repo.getForActor(tenantA, actorA, id)
    expect(after?.downloadCount).toBe(5)
  })

  it("超過次數後回 410,並說得出該怎麼辦", async () => {
    const id = await seedReady({ downloads: 5 })
    const res = await download(id)
    expect(res.statusCode).toBe(410)
    const body = res.json() as { code: string; message: string }
    expect(body.code).toBe("EXPORT_DOWNLOAD_LIMIT")
    expect(body.message).toContain("重新建立")
  })

  it("已過期回 410", async () => {
    const id = await seedReady({ expiresInMs: -1_000 })
    const res = await download(id)
    expect(res.statusCode).toBe(410)
    expect((res.json() as { code: string }).code).toBe("EXPORT_EXPIRED")
  })

  it("🔴 跨租戶下載不到", async () => {
    const id = await seedReady()
    const res = await app.inject({
      method: "POST",
      url: `/api/exports/${String(id)}/download`,
      headers: { "x-dev-tenant": String(tenantB), "x-dev-actor": String(actorA) },
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })

  /* 🔴 到期清理:檔案刪掉、**列留著**。 */
  it("🔴 到期清理刪檔但保留稽核列", async () => {
    const id = await seedReady({ expiresInMs: -1_000 })
    const { access } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const before = await repo.getForActor(tenantA, actorA, id)
    const key = before?.objectKey ?? ""
    await expect(access(join(storageDir, key))).resolves.toBeUndefined()

    const { ExportWorkerService } = await import("../src/export/export-worker.service.js")
    await app.get(ExportWorkerService).expire()

    await expect(access(join(storageDir, key))).rejects.toThrow()
    const after = await repo.getForActor(tenantA, actorA, id)
    expect(after).not.toBeNull()
    expect(after?.status).toBe("expired")
    expect(after?.requestedByActorId).toBe(actorA)
  })
})
