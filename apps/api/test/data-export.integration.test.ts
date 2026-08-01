import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { ExportRepository } from "../src/export/export.repository.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

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

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
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
    .values([{ authUserId: "ex-admin", email: "ex@weyver.test", name: "管理員" }])
    .returning()
  actorA = u[0]?.id ?? 0

  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  appPool = new pg.Pool({ connectionString: appUri.toString() })

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
    const list = await repo.listForTenant(tenantA)
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(job.id)
  })

  it("🔴 跨租戶讀不到 —— RLS 執法,不靠服務層記得加 WHERE", async () => {
    await reset()
    const job = await repo.create({
      tenantId: tenantA,
      actorId: actorA,
      formIds: null,
      includeAttachments: false,
    })
    expect(await repo.listForTenant(tenantB)).toHaveLength(0)
    expect(await repo.getForTenant(tenantB, job.id)).toBeNull()
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
      await expect(client.query(`DELETE FROM export_job WHERE id = $1`, [job.id])).rejects.toThrow(
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
    const after = await repo.getForTenant(tenantA, job?.id ?? 0)
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

    const after = await repo.getForTenant(tenantA, id)
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

      const jobs = await repo.listForTenant(tenantA)
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
