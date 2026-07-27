import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { eq } from "drizzle-orm"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle, type DrizzleDb } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"

/* F-6 M2|per-tenant 配額(form-engine-core FMEA C5)。
   驗:表數 / 欄數 / bulk 記錄數上限;NULL = 用系統預設(既有租戶零遷移);超限為 403 QUOTA_EXCEEDED。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let app: NestFastifyApplication
let tenantA = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
let seq = 0
const uniqueName = (): string => `配額表_${++seq}_${Date.now().toString().slice(-5)}`

const createForm = (fields: { name: string; type: string }[] = [{ name: "品名", type: "text" }]) =>
  app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: { name: uniqueName(), fields },
  })

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db.insert(tenants).values([{ name: "廠 A" }]).returning()
  tenantA = rows[0]?.id ?? 0

  process.env.DATABASE_URL = uri
  process.env.APP_DATABASE_URL = uri
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

async function setQuota(patch: Partial<typeof tenants.$inferInsert>): Promise<void> {
  await db.update(tenants).set(patch).where(eq(tenants.id, tenantA))
}

describe("F-6 M2 per-tenant 配額", () => {
  it("NULL 配額 → 用系統預設,正常建表不受影響", async () => {
    await setQuota({ maxForms: null, maxFieldsPerForm: null, maxRecordsPerForm: null })
    expect((await createForm()).statusCode).toBe(201)
  })

  it("表數達上限 → 403 QUOTA_EXCEEDED", async () => {
    await setQuota({ maxForms: 1 })
    const res = await createForm()
    expect(res.statusCode).toBe(403)
    const body = res.json() as { code: string; message: string }
    expect(body.code).toBe("QUOTA_EXCEEDED")
    expect(body.message).toContain("聯絡管理員")
    await setQuota({ maxForms: null })
  })

  it("建表時整批欄數超限 → 403(建表前擋,不留半殘 metadata)", async () => {
    await setQuota({ maxFieldsPerForm: 2 })
    const res = await createForm([
      { name: "a", type: "text" },
      { name: "b", type: "text" },
      { name: "c", type: "text" },
    ])
    expect(res.statusCode).toBe(403)
    expect((res.json() as { code: string }).code).toBe("QUOTA_EXCEEDED")
    await setQuota({ maxFieldsPerForm: null })
  })

  it("加欄達上限 → 403", async () => {
    const created = await createForm([{ name: "品名", type: "text" }])
    const formId = (created.json() as { id: number }).id
    await setQuota({ maxFieldsPerForm: 1 })
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/fields`,
      headers: A(),
      payload: { name: "新欄", type: "text", required: false, unique: false },
    })
    expect(res.statusCode).toBe(403)
    await setQuota({ maxFieldsPerForm: null })
  })

  it("bulk 記錄數超限 → 403;單筆路徑不做 count(不受此限)", async () => {
    const created = await createForm([{ name: "品名", type: "text" }])
    const formId = (created.json() as { id: number }).id
    await setQuota({ maxRecordsPerForm: 2 })

    const bulk = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records/bulk`,
      headers: A(),
      payload: { rows: [{ values: { 品名: "a" } }, { values: { 品名: "b" } }, { values: { 品名: "c" } }] },
    })
    expect(bulk.statusCode).toBe(403)
    expect((bulk.json() as { code: string }).code).toBe("QUOTA_EXCEEDED")

    const ok = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records/bulk`,
      headers: A(),
      payload: { rows: [{ values: { 品名: "a" } }, { values: { 品名: "b" } }] },
    })
    expect(ok.statusCode).toBe(200)
    await setQuota({ maxRecordsPerForm: null })
  })
})
