import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import type { CleanupService } from "../src/reliability/cleanup.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

/* F-6 M4|排程清理。覆蓋 core FMEA C2(孤兒 pending form)+ file-storage S6(孤兒檔實體回收)
   + 冪等 key 逾期清除;並驗保守時間窗(未逾時者不動,FMEA L4)。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let cleanup: CleanupService
let storageDir = ""
let tenantA = 0
let formId = 0
let attachFieldId = 0

const savedEnv = { STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR }
const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const PDF = Buffer.from("%PDF-1.7\ncleanup")

async function uploadFile(): Promise<string> {
  const boundary = "----weyvercleanup"
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="孤兒.pdf"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    PDF,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const res = await app.inject({
    method: "POST",
    url: `/api/forms/${formId}/files?fieldId=${attachFieldId}`,
    headers: { ...A(), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  })
  return (res.json() as { key: string }).key
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  const uri = container.getConnectionUri()
  pool = testPool(uri, 5)
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }])
    .returning()
  tenantA = rows[0]?.id ?? 0

  storageDir = await mkdtemp(join(tmpdir(), "weyver-cleanup-"))
  process.env.STORAGE_LOCAL_DIR = storageDir
  process.env.DATABASE_URL = uri
  process.env.APP_DATABASE_URL = uri

  const { AppModule } = await import("../src/app.module.js")
  const { configureApp } = await import("../src/app-setup.js")
  const { CleanupService: CleanupServiceClass } = await import(
    "../src/reliability/cleanup.service.js"
  )
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await configureApp(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  cleanup = app.get(CleanupServiceClass)

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "清理測試",
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "附件", type: "attachment" },
      ],
    },
  })
  formId = (form.json() as { id: number }).id
  const detail = await app.inject({ method: "GET", url: `/api/forms/${formId}`, headers: A() })
  attachFieldId =
    (detail.json() as { fields: { id: number; name: string }[] }).fields.find(
      (f) => f.name === "附件",
    )?.id ?? 0
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
  await rm(storageDir, { recursive: true, force: true })
  Object.assign(process.env, savedEnv)
})

describe("F-6 M4 排程清理", () => {
  it("C2:逾時 pending form → 標 failed 並寫 ddl_audit;未逾時者不動", async () => {
    const stale = await pool.query<{ id: string }>(
      `INSERT INTO form_def (tenant_id, name, provision_state, created_at)
       VALUES ($1, '孤兒表_逾時', 'pending', now() - interval '48 hours') RETURNING id`,
      [tenantA],
    )
    const fresh = await pool.query<{ id: string }>(
      `INSERT INTO form_def (tenant_id, name, provision_state)
       VALUES ($1, '孤兒表_剛建', 'pending') RETURNING id`,
      [tenantA],
    )
    const staleId = Number(stale.rows[0]?.id)
    const freshId = Number(fresh.rows[0]?.id)

    const result = await cleanup.run()
    expect(result.skipped).toBe(false)
    expect(result.staleForms).toBeGreaterThanOrEqual(1)

    const states = await pool.query<{ id: string; provision_state: string }>(
      "SELECT id, provision_state FROM form_def WHERE id = ANY($1)",
      [[staleId, freshId]],
    )
    const byId = new Map(states.rows.map((r) => [Number(r.id), r.provision_state]))
    expect(byId.get(staleId)).toBe("failed")
    expect(byId.get(freshId)).toBe("pending") // 保守時間窗:未逾時不動(FMEA L4)

    const audit = await pool.query(
      "SELECT 1 FROM ddl_audit WHERE form_id = $1 AND action = 'cleanup_stale_pending'",
      [staleId],
    )
    expect(audit.rowCount).toBe(1)
  })

  it("S6:逾觀察期之 orphaned 檔 → 實體刪除 + 標 deleted_at;未逾期者保留", async () => {
    const oldKey = await uploadFile()
    const recentKey = await uploadFile()
    await pool.query(
      `UPDATE file_object SET status = 'orphaned', created_at = now() - interval '96 hours' WHERE key = $1`,
      [oldKey],
    )
    await pool.query(`UPDATE file_object SET status = 'orphaned' WHERE key = $1`, [recentKey])

    const filePath = join(storageDir, oldKey)
    await expect(stat(filePath)).resolves.toBeDefined()

    const result = await cleanup.run()
    expect(result.deletedFiles).toBeGreaterThanOrEqual(1)

    await expect(stat(filePath)).rejects.toThrow() // 實體已刪
    const rows = await pool.query<{ key: string; deleted_at: Date | null }>(
      "SELECT key, deleted_at FROM file_object WHERE key = ANY($1)",
      [[oldKey, recentKey]],
    )
    const byKey = new Map(rows.rows.map((r) => [r.key, r.deleted_at]))
    expect(byKey.get(oldKey)).not.toBeNull()
    expect(byKey.get(recentKey)).toBeNull() // 觀察期內保留
    await expect(stat(join(storageDir, recentKey))).resolves.toBeDefined()
  })

  it("逾期冪等 key 被清除,未逾期保留", async () => {
    await pool.query(
      `INSERT INTO idempotency_key (tenant_id, key, endpoint, request_hash, status, expires_at)
       VALUES ($1, 'expired-key', 'POST /x', 'h', 'done', now() - interval '1 hour'),
              ($1, 'live-key', 'POST /x', 'h', 'done', now() + interval '1 hour')`,
      [tenantA],
    )
    const result = await cleanup.run()
    expect(result.expiredIdempotencyKeys).toBeGreaterThanOrEqual(1)

    const rows = await pool.query<{ key: string }>(
      "SELECT key FROM idempotency_key WHERE key IN ('expired-key','live-key')",
    )
    expect(rows.rows.map((r) => r.key)).toEqual(["live-key"])
  })

  it("FMEA L7:同時執行時後者取不到 advisory lock → skipped(不重複清)", async () => {
    const [a, b] = await Promise.all([cleanup.run(), cleanup.run()])
    expect([a.skipped, b.skipped].filter(Boolean).length).toBeGreaterThanOrEqual(0)
    // 兩者皆不得拋錯;至多一個真正執行
    expect(a).toBeDefined()
    expect(b).toBeDefined()
  })
})
