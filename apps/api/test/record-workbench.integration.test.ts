import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { type DrizzleDb, TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"

/* R1·workbench-uplift M1|A5 後端小端點:users lookup(OQ-RWB-7=A)+ 反向關聯(OQ-RWB-4=B)。
   重點斷言:跨租戶不外洩(users lookup 只回同租戶成員)、無權來源表之關聯整組不回。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let app: NestFastifyApplication
let tenantA = 0
let tenantB = 0
let actorA = 0
let actorB = 0
let supplierFormId = 0
let poFormId = 0
let supplierRecordId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const trows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = trows[0]?.id ?? 0
  tenantB = trows[1]?.id ?? 0

  const urows = await db
    .insert(users)
    .values([
      { authUserId: "u-a", email: "wang@a.test", name: "王小明" },
      { authUserId: "u-b", email: "chen@b.test", name: "陳大文" },
    ])
    .returning()
  actorA = urows[0]?.id ?? 0
  actorB = urows[1]?.id ?? 0

  // 各自租戶之成員關係(users lookup 的隔離依據)
  const repo = new AuthzRepository(db, new TenantDb(db))
  await repo.seedSystemRoles(tenantA)
  await repo.seedSystemRoles(tenantB)
  await repo.assignActorToSystemRole(tenantA, "admin", actorA)
  await repo.assignActorToSystemRole(tenantB, "admin", actorB)

  process.env.DATABASE_URL = uri
  process.env.APP_DATABASE_URL = uri
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  // 供應商(被引用)+ 採購單(引用者,含 link 欄)
  const supplier = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: { name: "供應商", fields: [{ name: "名稱", type: "text", required: true }] },
  })
  supplierFormId = (supplier.json() as { id: number }).id

  const po = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "採購單",
      fields: [
        { name: "單號", type: "text", required: true },
        { name: "供應商", type: "link", options: { targetFormId: supplierFormId } },
      ],
    },
  })
  poFormId = (po.json() as { id: number }).id

  const created = await app.inject({
    method: "POST",
    url: `/api/forms/${supplierFormId}/records`,
    headers: A(),
    payload: { values: { 名稱: "鑫豐食品" } },
  })
  supplierRecordId = (created.json() as { id: number }).id

  for (const no of ["PO-001", "PO-002"]) {
    await app.inject({
      method: "POST",
      url: `/api/forms/${poFormId}/records`,
      headers: A(),
      payload: { values: { 單號: no, 供應商: supplierRecordId } },
    })
  }
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("A5 users lookup(OQ-RWB-7=A)", () => {
  it("解析同租戶 actor id → 顯示名(不回 email)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/users/lookup?ids=${actorA}`,
      headers: A(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { id: number; name: string }[]
    expect(body).toEqual([{ id: actorA, name: "王小明" }])
    expect(JSON.stringify(body)).not.toContain("@")
  })

  it("跨租戶不外洩:A 查 B 的使用者 → 空", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/users/lookup?ids=${actorB}`,
      headers: A(),
    })
    expect(res.json()).toEqual([])

    const asB = await app.inject({
      method: "GET",
      url: `/api/users/lookup?ids=${actorB}`,
      headers: B(),
    })
    expect((asB.json() as { name: string }[])[0]?.name).toBe("陳大文")
  })

  it("混合 id 只回有權者;無效 / 空參數 → 空陣列", async () => {
    const mixed = await app.inject({
      method: "GET",
      url: `/api/users/lookup?ids=${actorA},${actorB},999999`,
      headers: A(),
    })
    expect(mixed.json()).toEqual([{ id: actorA, name: "王小明" }])

    const empty = await app.inject({ method: "GET", url: "/api/users/lookup", headers: A() })
    expect(empty.json()).toEqual([])
  })
})

describe("A3 反向關聯(OQ-RWB-4=B)", () => {
  it("供應商記錄 → 回被哪些採購單引用", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${supplierFormId}/records/${supplierRecordId}/relations`,
      headers: A(),
    })
    expect(res.statusCode).toBe(200)
    const groups = res.json() as {
      formId: number
      formName: string
      viaFieldName: string
      records: { id: number; title: string }[]
      truncated: boolean
    }[]
    expect(groups).toHaveLength(1)
    expect(groups[0]?.formName).toBe("採購單")
    expect(groups[0]?.viaFieldName).toBe("供應商")
    expect(groups[0]?.records.map((r) => r.title).sort()).toEqual(["PO-001", "PO-002"])
    expect(groups[0]?.truncated).toBe(false)
  })

  it("未被引用之記錄 → 空陣列", async () => {
    const other = await app.inject({
      method: "POST",
      url: `/api/forms/${supplierFormId}/records`,
      headers: A(),
      payload: { values: { 名稱: "無人引用" } },
    })
    const id = (other.json() as { id: number }).id
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${supplierFormId}/records/${id}/relations`,
      headers: A(),
    })
    expect(res.json()).toEqual([])
  })

  it("跨租戶:B 查 A 的記錄關聯 → 空(RLS 兜底,不洩漏任何摘要)", async () => {
    // dev header 恆為 super admin → 不會 403;真正的隔離由 tenant scope + RLS 執行
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${supplierFormId}/records/${supplierRecordId}/relations`,
      headers: B(),
    })
    expect(res.json()).toEqual([])
    expect(res.payload).not.toContain("PO-001")
  })
})
