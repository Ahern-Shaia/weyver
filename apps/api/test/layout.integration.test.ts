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
let noteFieldId = 0
let dateFieldId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

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

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "登記表",
      fields: [
        { name: "備註", type: "text" },
        { name: "登記日", type: "date" },
      ],
    },
  })
  const body = form.json() as { id: number; fields: { id: number; name: string }[] }
  formId = body.id
  noteFieldId = body.fields.find((f) => f.name === "備註")?.id ?? 0
  dateFieldId = body.fields.find((f) => f.name === "登記日")?.id ?? 0
})

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const putLayout = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/api/forms/${formId}/layout`, headers, payload })

describe("R1·UP-3 form_def.layout API + 預設值", () => {
  it("PUT layout → GET 回相同(座標 + 設定)", async () => {
    const layout = {
      grid: { cols: 12 },
      fields: {
        [String(noteFieldId)]: { row: 0, col: 0, colSpan: 2, placeholder: "選填" },
        [String(dateFieldId)]: { row: 1, col: 0 },
      },
    }
    const put = await putLayout(A(), layout)
    expect(put.statusCode).toBe(200)

    const get = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
    })
    expect(get.statusCode).toBe(200)
    const got = get.json() as { layout: { fields: Record<string, { placeholder?: string }> } }
    expect(got.layout.fields[String(noteFieldId)]?.placeholder).toBe("選填")
  })

  it("PUT layout 引用不存在的 fieldId → 422", async () => {
    const res = await putLayout(A(), {
      fields: { "99999999": { row: 0, col: 0 } },
    })
    expect(res.statusCode).toBe(422)
    expect((res.json() as { code: string }).code).toBe("INVALID_FIELD_INPUT")
  })

  it("PUT layout 之 href 非 https → 400(VALIDATION_FAILED)", async () => {
    const res = await putLayout(A(), {
      fields: {},
      statics: [{ id: "s1", kind: "text", row: 0, col: 0, text: "x", href: "javascript:alert(1)" }],
    })
    expect(res.statusCode).toBe(400)
  })

  it("預設值:literal + $DATE + $USERID 於 createRecord 自動填", async () => {
    await putLayout(A(), {
      fields: {
        [String(noteFieldId)]: {
          row: 0,
          col: 0,
          defaultValue: { kind: "literal", value: "預設備註" },
        },
        [String(dateFieldId)]: {
          row: 1,
          col: 0,
          defaultValue: { kind: "variable", value: "$DATE" },
        },
      },
    })
    const create = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: {} },
    })
    expect(create.statusCode).toBe(201)
    const record = create.json() as { values: Record<string, unknown> }
    expect(record.values.備註).toBe("預設備註")
    expect(record.values.登記日).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("預設值不覆蓋使用者提供的值", async () => {
    const create = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: { 備註: "使用者輸入" } },
    })
    expect((create.json() as { values: Record<string, unknown> }).values.備註).toBe("使用者輸入")
  })

  it("跨租戶:B PUT A 的 layout → 404", async () => {
    const res = await putLayout(B(), { fields: {} })
    expect(res.statusCode).toBe(404)
  })
})
