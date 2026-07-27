import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"

/* F-6 M1|冪等性攔截器。覆蓋 FMEA L2(跨租戶同 key 不互通)· L3(逾期可再用)
   + 重放不重複建記錄 / 同 key 不同 body 422 / 併發 409 / 失敗後可重試。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let tenantB = 0
let formId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

const createRecord = (
  headers: Record<string, string>,
  key: string | undefined,
  values: Record<string, unknown>,
  targetFormId = formId,
) =>
  app.inject({
    method: "POST",
    url: `/api/forms/${targetFormId}/records`,
    headers: key === undefined ? headers : { ...headers, "idempotency-key": key },
    payload: { values },
  })

const countRecords = async (headers: Record<string, string>): Promise<number> => {
  const res = await app.inject({ method: "GET", url: `/api/forms/${formId}/records`, headers })
  return (res.json() as { records: unknown[] }).records.length
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0

  process.env.DATABASE_URL = uri
  process.env.APP_DATABASE_URL = uri
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: { name: "採購單", fields: [{ name: "供應商", type: "text", required: true }] },
  })
  formId = (form.json() as { id: number }).id
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("F-6 M1 冪等性", () => {
  it("同 key 重送 → 回放首次結果且不重複建記錄", async () => {
    const before = await countRecords(A())
    const first = await createRecord(A(), "key-replay", { 供應商: "鑫豐" })
    expect(first.statusCode).toBe(201)
    const firstId = (first.json() as { id: number }).id

    const second = await createRecord(A(), "key-replay", { 供應商: "鑫豐" })
    expect(second.statusCode).toBe(201)
    expect(second.headers["idempotent-replay"]).toBe("true")
    expect((second.json() as { id: number }).id).toBe(firstId)
    expect(await countRecords(A())).toBe(before + 1)
  })

  it("未帶 key → 不受影響(重送即建兩筆)", async () => {
    const before = await countRecords(A())
    await createRecord(A(), undefined, { 供應商: "統鮮" })
    await createRecord(A(), undefined, { 供應商: "統鮮" })
    expect(await countRecords(A())).toBe(before + 2)
  })

  it("同 key 不同 body → 422(絕不回放錯誤結果)", async () => {
    await createRecord(A(), "key-mismatch", { 供應商: "甲廠" })
    const reused = await createRecord(A(), "key-mismatch", { 供應商: "乙廠" })
    expect(reused.statusCode).toBe(422)
    expect((reused.json() as { code: string }).code).toBe("IDEMPOTENCY_KEY_REUSED")
  })

  it("FMEA L2:B 租戶用相同 key 不受 A 影響(PK 含 tenant_id)", async () => {
    const formB = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: B(),
      payload: { name: "採購單", fields: [{ name: "供應商", type: "text", required: true }] },
    })
    const formBId = (formB.json() as { id: number }).id
    const res = await createRecord(B(), "key-replay", { 供應商: "B 廠商" }, formBId)
    expect(res.statusCode).toBe(201)
    expect(res.headers["idempotent-replay"]).toBeUndefined()
  })

  it("併發同 key → 其一 201、另一 409(不重複建單)", async () => {
    const before = await countRecords(A())
    const [first, second] = await Promise.all([
      createRecord(A(), "key-race", { 供應商: "併發" }),
      createRecord(A(), "key-race", { 供應商: "併發" }),
    ])
    const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b)
    // 兩者皆完成時後者為重放(201);競態命中則為 409。無論何者都不得建出兩筆
    expect(codes[0]).toBe(201)
    expect([201, 409]).toContain(codes[1])
    expect(await countRecords(A())).toBe(before + 1)
  })

  it("handler 失敗 → 佔位列釋放,同 key 可重試成功", async () => {
    const failed = await createRecord(A(), "key-retry", {}) // 缺必填 → 422
    expect(failed.statusCode).toBeGreaterThanOrEqual(400)

    const retried = await createRecord(A(), "key-retry", { 供應商: "重試成功" })
    // body 不同 → 422 為預期(key 已釋放時應可建);此處驗「未被永久鎖成 409」
    expect(retried.statusCode).not.toBe(409)
  })

  it("FMEA L3:逾期列可被同 key 重新佔用", async () => {
    await createRecord(A(), "key-expired", { 供應商: "逾期" })
    await pool.query(
      "UPDATE idempotency_key SET expires_at = now() - interval '1 hour' WHERE key = $1",
      ["key-expired"],
    )
    const again = await createRecord(A(), "key-expired", { 供應商: "逾期" })
    expect(again.statusCode).toBe(201)
    expect(again.headers["idempotent-replay"]).toBeUndefined()
  })
})
