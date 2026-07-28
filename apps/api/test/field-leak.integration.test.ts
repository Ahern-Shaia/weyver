import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { EffectivePermissions } from "../src/authz/authz-effective.js"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { RecordService } from "../src/form-engine/records/record.service.js"

/* 🔴 追溯稽核|欄位級權限的**旁路**洩漏。

   「查完再遮」只擋回傳值,擋不住**用查詢反推值**。本檔逐條斷言:
   隱藏欄不得出現在 WHERE / ORDER BY / 快速搜尋。

   業界前例:Salesforce `WITH SECURITY_ENFORCED` 官方明載只檢查 SELECT/FROM
   不含 WHERE 與 ORDER BY;Odoo 有多個同類 CVE(匯出漏檢 CVE-2024-12368 等)。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let records: RecordService
let tenantId = 0
let formId = 0
let salaryFieldId = 0
let reasonFieldId = 0

/* 只看得到「姓名」,「月薪」為 hidden */
function limitedPerms(): EffectivePermissions {
  return new EffectivePermissions(
    false,
    new Map([[formId, new Set(["view" as const])]]),
    new Map([
      [salaryFieldId, "hidden" as const],
      [reasonFieldId, "hidden" as const],
    ]),
    new Set(),
  )
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  tenantId = (await db.insert(tenants).values([{ name: "廠 A" }]).returning())[0]?.id ?? 0

  process.env.DATABASE_URL = uri
  process.env.APP_DATABASE_URL = uri
  const { AppModule } = await import("../src/app.module.js")
  const { configureApp } = await import("../src/app-setup.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await configureApp(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  records = app.get(RecordService)

  const created = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" },
    payload: {
      name: "員工薪資",
      fields: [
        { name: "姓名", type: "text", required: true },
        { name: "月薪", type: "money" },
        /* 快速搜尋只掃 text 型欄 → 要驗搜尋旁路必須有一個**隱藏的文字欄** */
        { name: "離職原因", type: "text" },
      ],
    },
  })
  formId = (created.json() as { id: number }).id
  const detail = await app.inject({
    method: "GET",
    url: `/api/forms/${formId}`,
    headers: { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" },
  })
  const fields = (detail.json() as { fields: { id: number; name: string }[] }).fields
  salaryFieldId = fields.find((f) => f.name === "月薪")?.id ?? 0
  reasonFieldId = fields.find((f) => f.name === "離職原因")?.id ?? 0
  expect(salaryFieldId).toBeGreaterThan(0)
  expect(reasonFieldId).toBeGreaterThan(0)

  for (const [name, salary, reason] of [
    ["甲", "30000", "留任"],
    ["乙", "80000", "涉嫌侵占"],
    ["丙", "150000", "留任"],
  ]) {
    await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" },
      payload: { values: { 姓名: name, 月薪: salary, 離職原因: reason } },
    })
  }
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("隱藏欄不得成為查詢旁路", () => {
  it("值本身已遮罩(既有防線,基準)", async () => {
    const res = await records.listRecords(
      tenantId,
      formId,
      { filters: [], sort: [], limit: 50 },
      limitedPerms(),
    )
    expect(res.records).toHaveLength(3)
    for (const r of res.records) {
      expect(r.values.姓名).toBeDefined()
      expect(r.values.月薪).toBeUndefined()
    }
  })

  it("**篩選隱藏欄 → 拒絕** —— 否則可由回傳筆數二分逼近他人薪資", async () => {
    await expect(
      records.listRecords(
        tenantId,
        formId,
        { filters: [{ field: "月薪", op: "gt", value: "100000" }], sort: [], limit: 50 },
        limitedPerms(),
      ),
    ).rejects.toThrow(/月薪/)
  })

  it("**排序隱藏欄 → 拒絕** —— 否則可由列序推出大小關係", async () => {
    await expect(
      records.listRecords(
        tenantId,
        formId,
        { filters: [], sort: [{ field: "月薪", dir: "desc" }], limit: 50 },
        limitedPerms(),
      ),
    ).rejects.toThrow(/月薪/)
  })

  it("**快速搜尋跳過隱藏欄** —— 否則輸入值即可測知其是否存在", async () => {
    /* 搜尋是便利功能非指名查詢 → 跳過而不報錯;但不得掃進隱藏欄。
       「涉嫌侵占」只存在於隱藏的「離職原因」欄 —— 若搜尋掃到它,
       攻擊者即可用關鍵字逐一測知他人的離職原因。 */
    const res = await records.listRecords(
      tenantId,
      formId,
      { filters: [], sort: [], limit: 50, q: "侵占" },
      limitedPerms(),
    )
    expect(res.records).toHaveLength(0)

    // 對照:有權者搜同一關鍵字應命中
    const full = new EffectivePermissions(
      false,
      new Map([[formId, new Set(["view" as const])]]),
      new Map([[reasonFieldId, "read" as const]]),
      new Set(),
    )
    const visible = await records.listRecords(
      tenantId,
      formId,
      { filters: [], sort: [], limit: 50, q: "侵占" },
      full,
    )
    expect(visible.records).toHaveLength(1)
  })

  it("有權者不受影響:可篩選、可排序、看得到值", async () => {
    const full = new EffectivePermissions(
      false,
      new Map([[formId, new Set(["view" as const])]]),
      new Map([[salaryFieldId, "read" as const]]),
      new Set(),
    )
    const res = await records.listRecords(
      tenantId,
      formId,
      {
        filters: [{ field: "月薪", op: "gt", value: "100000" }],
        sort: [{ field: "月薪", dir: "desc" }],
        limit: 50,
      },
      full,
    )
    expect(res.records).toHaveLength(1)
    expect(res.records[0]?.values.姓名).toBe("丙")
  })
})
