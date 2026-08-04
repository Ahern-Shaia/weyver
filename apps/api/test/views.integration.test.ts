import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let tenantB = 0
let formId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

interface ViewDto {
  id: number
  formId: number
  name: string
  scope: string
  isDefault: boolean
  locked: boolean
  config: {
    fields: string[]
    sorts: { field: string; dir: string }[]
    groupBy?: { field: string; dir: string; unit?: string }[]
    aggregates?: { field: string; fn: string }[]
  }
  position: number
  createdBy: number | null
  updatedAt: string
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
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

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "採購單",
      fields: [
        { name: "供應商", type: "text", required: true },
        { name: "金額", type: "money" },
      ],
    },
  })
  formId = (form.json() as { id: number }).id
})

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const createView = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/api/forms/${formId}/views`, headers, payload })

describe("R1·UP-2 view_def CRUD + 隔離", () => {
  it("建個人視圖 → 201,scope=personal,createdBy=actor", async () => {
    const res = await createView(A(), {
      name: "我的待審",
      config: {
        fields: ["供應商", "金額"],
        filter: { combinator: "and", conditions: [] },
        sorts: [{ field: "金額", dir: "desc" }],
      },
    })
    expect(res.statusCode).toBe(201)
    const view = res.json() as ViewDto
    expect(view.scope).toBe("personal")
    expect(view.isDefault).toBe(false)
    // dev x-dev-actor 非真實 users 列 → createdBy 落 null(prod 為真實 user)
    expect(view.createdBy).toBeNull()
    expect(view.config.sorts).toEqual([{ field: "金額", dir: "desc" }])
  })

  it("列表含剛建的視圖", async () => {
    const res = await app.inject({ method: "GET", url: `/api/forms/${formId}/views`, headers: A() })
    expect(res.statusCode).toBe(200)
    const views = res.json() as ViewDto[]
    expect(views.some((v) => v.name === "我的待審")).toBe(true)
  })

  it("個人視圖 + isDefault → 400(預設必須為共通)", async () => {
    const res = await createView(A(), {
      name: "壞預設",
      scope: "personal",
      isDefault: true,
      config: { fields: [] },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { code: string }).code).toBe("INVALID_VIEW")
  })

  it("每 (租戶,表單) 至多一個預設:設新預設 → 舊預設被清", async () => {
    const first = await createView(A(), {
      name: "共通預設一",
      scope: "shared",
      isDefault: true,
      config: { fields: [] },
    })
    expect(first.statusCode).toBe(201)
    const firstId = (first.json() as ViewDto).id

    const second = await createView(A(), {
      name: "共通預設二",
      scope: "shared",
      isDefault: true,
      config: { fields: [] },
    })
    expect(second.statusCode).toBe(201)

    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/views`,
      headers: A(),
    })
    const views = list.json() as ViewDto[]
    const defaults = views.filter((v) => v.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0]?.name).toBe("共通預設二")
    expect(views.find((v) => v.id === firstId)?.isDefault).toBe(false)
  })

  it("更新視圖名稱 → 200", async () => {
    const created = await createView(A(), { name: "改名前", config: { fields: [] } })
    const id = (created.json() as ViewDto).id
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/views/${id}`,
      headers: A(),
      payload: { name: "改名後" },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as ViewDto).name).toBe("改名後")
  })

  it("刪除視圖 → 204,列表不再含", async () => {
    const created = await createView(A(), { name: "待刪", config: { fields: [] } })
    const id = (created.json() as ViewDto).id
    const del = await app.inject({
      method: "DELETE",
      url: `/api/forms/${formId}/views/${id}`,
      headers: A(),
    })
    expect(del.statusCode).toBe(204)
    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/views`,
      headers: A(),
    })
    expect((list.json() as ViewDto[]).some((v) => v.id === id)).toBe(false)
  })

  it("跨租戶:B 列 A 表單之視圖 → 空(app 層 tenant scope)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/forms/${formId}/views`, headers: B() })
    expect(res.statusCode).toBe(200)
    expect(res.json() as ViewDto[]).toEqual([])
  })

  it("跨租戶:B 改 A 的視圖 → 404", async () => {
    const created = await createView(A(), { name: "A 私有", config: { fields: [] } })
    const id = (created.json() as ViewDto).id
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/views/${id}`,
      headers: B(),
      payload: { name: "B 竄改" },
    })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { code: string }).code).toBe("VIEW_NOT_FOUND")
  })
})

/* 🔴 audit-D §2.1|**存了要讀得回來**。

   這一段之所以存在,是因為原本一條都沒有:`views.spec.ts` 只斷言「檢視出現在
   選擇器」,而分組與小計**根本沒有進到後端 schema** —— zod 非 strict,未知鍵直接
   strip,於是使用者設好分組按「另存」,存進去是空的,重載回來什麼都沒有,
   **而且沒有任何錯誤**。前端 schema 有、後端沒有,兩份鏡射漂移了兩個月沒人發現。

   ⚠️ 判準不是「欄位有沒有加進 schema」,是「**送什麼進去就要拿什麼出來**」——
   前者下次還會漏,後者不會。 */
describe("view config round-trip(送什麼進去就要拿什麼出來)", () => {
  const CONFIG = {
    fields: ["供應商", "金額"],
    filter: { combinator: "and", conditions: [{ field: "金額", op: "gt", value: 100 }] },
    sorts: [{ field: "金額", dir: "desc" }],
    groupBy: [{ field: "供應商", dir: "asc" }],
    aggregates: [{ field: "金額", fn: "sum" }],
    pageSize: 50,
  }

  it("🔴 分組與小計存得進去、讀得回來", async () => {
    const res = await createView(A(), { name: "依供應商彙總", config: CONFIG })
    expect(res.statusCode).toBe(201)
    const created = res.json() as ViewDto
    expect(created.config.groupBy).toEqual([{ field: "供應商", dir: "asc" }])
    expect(created.config.aggregates).toEqual([{ field: "金額", fn: "sum" }])

    /* 重新讀清單 —— 存進 DB 再回來的那一趟才是真的 */
    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/views`,
      headers: A(),
    })
    const got = (list.json() as ViewDto[]).find((v) => v.name === "依供應商彙總")
    expect(got?.config.groupBy).toEqual([{ field: "供應商", dir: "asc" }])
    expect(got?.config.aggregates).toEqual([{ field: "金額", fn: "sum" }])
  })

  it("日期分組粒度(unit)不得被吃掉", async () => {
    const res = await createView(A(), {
      name: "按月",
      config: { ...CONFIG, groupBy: [{ field: "供應商", dir: "asc", unit: "month" }] },
    })
    expect(res.statusCode).toBe(201)
    expect((res.json() as ViewDto).config.groupBy?.[0]).toMatchObject({ unit: "month" })
  })

  it("未知的聚合函數 → 400(邊界仍然收斂,不是什麼都收)", async () => {
    const res = await createView(A(), {
      name: "壞的",
      config: { ...CONFIG, aggregates: [{ field: "金額", fn: "median" }] },
    })
    expect(res.statusCode).toBe(400)
  })
})
