import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { UsageService } from "../src/billing/usage.service.js"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { roleMembers, roles, tenants, users } from "../src/db/schema.js"

/* F-8 M2|用量快照。重點在 FMEA B3(跨租戶錯置 → 帳單算到別人頭上)與 B4(冪等 / 可補算)。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let usage: UsageService
let tenantA = 0
let tenantB = 0

const DAY = "2026-07-20"
const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })

async function metricValue(tenantId: number, metric: string, day = DAY): Promise<number> {
  const rows = await pool.query<{ value: string }>(
    "SELECT value FROM tenant_usage_daily WHERE tenant_id=$1 AND day=$2 AND metric=$3",
    [tenantId, day, metric],
  )
  return Number(rows.rows[0]?.value ?? -1)
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const tenantRows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = tenantRows[0]?.id ?? 0
  tenantB = tenantRows[1]?.id ?? 0

  // A 有 2 名成員(其中 1 名一人雙角色 → 仍只算 1 席),B 有 1 名
  const userRows = await db
    .insert(users)
    .values([
      { authUserId: "u1", email: "u1@weyver.test" },
      { authUserId: "u2", email: "u2@weyver.test" },
      { authUserId: "u3", email: "u3@weyver.test" },
      { authUserId: "gone", email: "gone@weyver.test", deletedAt: new Date() },
    ])
    .returning()
  const [u1, u2, u3, gone] = userRows
  const roleRows = await db
    .insert(roles)
    .values([
      { tenantId: tenantA, key: "admin", name: "管理員" },
      { tenantId: tenantA, key: "editor", name: "編輯者" },
      { tenantId: tenantB, key: "admin", name: "管理員" },
    ])
    .returning()
  const [aAdmin, aEditor, bAdmin] = roleRows
  await db.insert(roleMembers).values([
    { tenantId: tenantA, roleId: aAdmin?.id ?? 0, actorId: u1?.id ?? 0 },
    { tenantId: tenantA, roleId: aEditor?.id ?? 0, actorId: u1?.id ?? 0 }, // 同一人雙角色
    { tenantId: tenantA, roleId: aAdmin?.id ?? 0, actorId: u2?.id ?? 0 },
    { tenantId: tenantA, roleId: aEditor?.id ?? 0, actorId: gone?.id ?? 0 }, // 已停用
    { tenantId: tenantB, roleId: bAdmin?.id ?? 0, actorId: u3?.id ?? 0 },
  ])

  process.env.DATABASE_URL = uri
  process.env.APP_DATABASE_URL = uri
  const { AppModule } = await import("../src/app.module.js")
  const { configureApp } = await import("../src/app-setup.js")
  const { UsageService: UsageServiceClass } = await import("../src/billing/usage.service.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await configureApp(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  usage = app.get(UsageServiceClass)

  await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: { name: "用量測試", fields: [{ name: "品名", type: "text", required: true }] },
  })
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("F-8 用量快照", () => {
  it("採計計費席位:一人雙角色算 1 席、已停用者不計(OQ-SB-3=A)", async () => {
    const result = await usage.run(DAY)
    expect(result.skipped).toBe(false)
    expect(result.tenants).toBe(2)
    expect(await metricValue(tenantA, "billable_users")).toBe(2)
  })

  it("**FMEA B3**:租戶用量不互相汙染", async () => {
    expect(await metricValue(tenantB, "billable_users")).toBe(1)
    expect(await metricValue(tenantA, "forms")).toBe(1)
    expect(await metricValue(tenantB, "forms")).toBe(0)
  })

  it("**FMEA B4**:重跑同一日冪等,不產生重複列", async () => {
    await usage.run(DAY)
    await usage.run(DAY)
    const rows = await pool.query<{ count: string }>(
      "SELECT count(*) FROM tenant_usage_daily WHERE tenant_id=$1 AND day=$2 AND metric='billable_users'",
      [tenantA, DAY],
    )
    expect(Number(rows.rows[0]?.count)).toBe(1)
  })

  it("**FMEA B4**:可補算指定日期,且不影響其他日的歷史", async () => {
    await usage.run("2026-07-19")
    expect(await metricValue(tenantA, "billable_users", "2026-07-19")).toBe(2)
    expect(await metricValue(tenantA, "billable_users")).toBe(2)
  })

  it("MAU 與計費席位分開記錄(OQ-SB-3:記錄但不計費)", async () => {
    expect(await metricValue(tenantA, "active_users")).toBeGreaterThanOrEqual(0)
    expect(await metricValue(tenantA, "billable_users")).toBe(2)
  })

  it("history() 回指定期間的用量", async () => {
    const rows = await usage.history(tenantA, "2026-07-19", DAY)
    expect(rows.length).toBeGreaterThan(4)
    expect(rows.every((r) => typeof r.metric === "string")).toBe(true)
  })

  it("**append-only**:app 車道無 UPDATE / DELETE 權限", async () => {
    const appPool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 2 })
    try {
      const client = await appPool.connect()
      await client.query("SET ROLE weyver_app")
      await expect(client.query("DELETE FROM tenant_usage_daily")).rejects.toThrow(/permission/i)
      await expect(client.query("UPDATE tenant_usage_daily SET value='0'")).rejects.toThrow(
        /permission/i,
      )
      client.release()
    } finally {
      await appPool.end()
    }
  })
})
