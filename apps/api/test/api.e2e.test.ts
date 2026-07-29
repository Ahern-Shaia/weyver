import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let tenantB = 0
let formId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB) })

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0

  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = container.getConnectionUri()
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("A7 REST API e2e", () => {
  it("rejects requests without tenant context (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/forms" })
    expect(res.statusCode).toBe(401)
    const body = res.json() as { code: string; correlationId: string }
    expect(body.code).toBe("TENANT_REQUIRED")
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("creates a form and never leaks physical identifiers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: "採購單",
        fields: [
          { name: "單號", type: "autoNumber", options: { prefix: "PO-" } },
          { name: "供應商", type: "text", required: true },
          { name: "金額", type: "money" },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as {
      id: number
      provisionState: string
      fields: { name: string }[]
    }
    formId = body.id
    expect(body.provisionState).toBe("ready")
    expect(body.fields).toHaveLength(3)
    expect(res.body).not.toContain("physical")
    expect(res.body).not.toContain("tenant")
  })

  it("400 on invalid form spec (duplicate field names)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: "壞表",
        fields: [
          { name: "同名", type: "text" },
          { name: "同名", type: "text" },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { code: string }).code).toBe("VALIDATION_FAILED")
  })

  it("record CRUD:create → autoNumber;stale version → 409 envelope", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: { 供應商: "鑫豐農產品", 金額: "128400.0000" } },
    })
    expect(create.statusCode).toBe(201)
    const record = create.json() as {
      id: number
      version: number
      createdBy: number
      values: Record<string, unknown>
    }
    expect(record.values.單號).toBe("PO-0001")
    expect(record.createdBy).toBe(7)

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${record.id}`,
      headers: A(),
      payload: { expectedVersion: 1, values: { 金額: "1.0000" } },
    })
    expect(ok.statusCode).toBe(200)

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${record.id}`,
      headers: A(),
      payload: { expectedVersion: 1, values: { 金額: "2.0000" } },
    })
    expect(stale.statusCode).toBe(409)
    const staleBody = stale.json() as { code: string; correlationId: string; timestamp: string }
    expect(staleBody.code).toBe("VERSION_CONFLICT")
    expect(stale.body).not.toContain("stack")
  })

  it("422 on unknown field / bad value", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: { 供應商: "x", 幽靈欄: 1 } },
    })
    expect(res.statusCode).toBe(422)
    expect((res.json() as { code: string }).code).toBe("INVALID_FIELD_INPUT")
  })

  it("cross-tenant access → 404(B 看不到 A 的表單)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/forms/${formId}`, headers: B() })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { code: string }).code).toBe("FORM_NOT_FOUND")
  })

  it("query endpoint filters records", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records/query`,
      headers: A(),
      payload: { filters: [{ field: "供應商", op: "contains", value: "鑫豐" }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { records: { values: Record<string, unknown> }[] }
    expect(body.records).toHaveLength(1)
  })

  it("save-with-lines endpoint round-trips a document", async () => {
    const parent = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: "訂單", fields: [{ name: "客戶", type: "text", required: true }] },
    })
    const parentId = (parent.json() as { id: number }).id
    const child = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: "訂單明細",
        parentFormId: parentId,
        fields: [
          { name: "品項", type: "text", required: true },
          { name: "數量", type: "number" },
        ],
      },
    })
    const childId = (child.json() as { id: number }).id

    const saved = await app.inject({
      method: "POST",
      url: `/api/forms/${parentId}/records/save-with-lines`,
      headers: A(),
      payload: {
        childFormId: childId,
        header: { values: { 客戶: "查理布朗" } },
        lines: [
          { values: { 品項: "冷凍雞腿", 數量: 10 } },
          { values: { 品項: "醬料包", 數量: 200 } },
        ],
      },
    })
    expect(saved.statusCode).toBe(200)
    const body = saved.json() as { header: { id: number }; lines: { lineNo: number }[] }
    expect(body.lines.map((l) => l.lineNo)).toEqual([1, 2])
  })

  it("dropped form returns 404 afterwards", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: "臨時表", fields: [{ name: "x", type: "text" }] },
    })
    const id = (created.json() as { id: number }).id
    const del = await app.inject({ method: "DELETE", url: `/api/forms/${id}`, headers: A() })
    expect(del.statusCode).toBe(204)
    const after = await app.inject({ method: "GET", url: `/api/forms/${id}`, headers: A() })
    expect(after.statusCode).toBe(404)
  })

  // R1·UP-1 workspace-ia M1:分類清單唯讀端點 + 跨租戶隔離
  it("GET /api/categories 回本租戶分類;跨租戶不洩", async () => {
    const cat = await app.inject({
      method: "POST",
      url: "/api/authz/categories",
      headers: A(),
      payload: { name: `採購${Date.now().toString().slice(-5)}` },
    })
    expect(cat.statusCode).toBe(201)
    const catId = (cat.json() as { id: number }).id

    const listA = await app.inject({ method: "GET", url: "/api/categories", headers: A() })
    expect(listA.statusCode).toBe(200)
    const rowsA = listA.json() as Array<{ id: number; name: string; position: number }>
    expect(rowsA.some((c) => c.id === catId)).toBe(true)
    // 只回 id/name/position,不洩 tenantId
    expect(Object.keys(rowsA[0] ?? {}).sort()).toEqual(["id", "name", "position"])

    const listB = await app.inject({ method: "GET", url: "/api/categories", headers: B() })
    expect(listB.statusCode).toBe(200)
    expect((listB.json() as Array<{ id: number }>).some((c) => c.id === catId)).toBe(false)
  })

  it("forms 清單 DTO 含 categoryId + updatedAt", async () => {
    const res = await app.inject({ method: "GET", url: "/api/forms", headers: A() })
    expect(res.statusCode).toBe(200)
    const rows = res.json() as Array<{ categoryId: number | null; updatedAt: string }>
    expect(rows.length).toBeGreaterThan(0)
    const r = rows[0]
    expect(r).toHaveProperty("categoryId")
    expect(typeof r?.updatedAt).toBe("string")
  })
})

/* 🔴 #105 型別轉換走完整 HTTP 路徑 —— service 全綠但沒有端點時,功能對使用者是零 */
describe("型別轉換端點(#105)", () => {
  let convFormId = 0
  let convFieldId = 0

  it("建表 + 灌入含壞值的資料", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: `轉換E2E_${String(Date.now()).slice(-6)}`, fields: [{ name: "值", type: "text" }] },
    })
    const body = created.json() as { id: number; fields: { id: number; name: string }[] }
    convFormId = body.id
    convFieldId = body.fields[0]?.id ?? 0
    for (const v of ["10", "N/A", "20"]) {
      await app.inject({
        method: "POST",
        url: `/api/forms/${convFormId}/records`,
        headers: A(),
        payload: { values: { 值: v } },
      })
    }
    expect(convFieldId).toBeGreaterThan(0)
  })

  it("**preview 回兩個數字 + 樣本值**,且不改動資料", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${convFormId}/fields/${convFieldId}/convert/preview`,
      headers: A(),
      payload: { type: "number" },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as {
      kind: string
      willBeNulled: number
      willBeAltered: number
      samples: string[]
    }
    expect(body.kind).toBe("lossy")
    expect(body.willBeNulled).toBe(1)
    expect(body.samples).toContain("N/A")

    const after = await app.inject({
      method: "GET",
      url: `/api/forms/${convFormId}/records`,
      headers: A(),
    })
    expect(after.body).toContain("N/A")
  })

  it("convert 執行後回 conversionId,再 revert 把值救回來", async () => {
    const done = await app.inject({
      method: "POST",
      url: `/api/forms/${convFormId}/fields/${convFieldId}/convert`,
      headers: A(),
      payload: { type: "number" },
    })
    const { conversionId } = done.json() as { conversionId: number }
    expect(conversionId).toBeGreaterThan(0)

    const reverted = await app.inject({
      method: "POST",
      url: `/api/forms/${convFormId}/fields/${convFieldId}/convert/${conversionId}/revert`,
      headers: A(),
    })
    expect(reverted.statusCode).toBe(201)

    const after = await app.inject({
      method: "GET",
      url: `/api/forms/${convFormId}/records`,
      headers: A(),
    })
    expect(after.body).toContain("N/A")
  })

  it("forbidden 轉換由端點層擋下", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${convFormId}/fields/${convFieldId}/convert`,
      headers: A(),
      payload: { type: "autoNumber" },
    })
    expect(res.statusCode).toBe(422)
  })
})
