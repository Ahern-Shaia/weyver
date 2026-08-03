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
let noteFieldId = 0
let dateFieldId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

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

/* R1·UP-3b 條件式格式:規則存於 layout(零 migration),tone 為受控白名單 */
describe("條件式格式(conditionalFormats)", () => {
  const putFormats = (formats: unknown) =>
    putLayout(A(), { fields: {}, conditionalFormats: formats })

  it("記錄頁 / 列表頁 各自一組規則 → round-trip", async () => {
    const res = await putFormats({
      record: [
        {
          combinator: "and",
          conditions: [
            { field: "登記日", op: "lt", value: "2026-08-01" },
            { field: "備註", op: "isNotEmpty" },
          ],
          targets: ["登記日"],
          tone: "error",
        },
      ],
      list: [
        {
          combinator: "or",
          conditions: [{ field: "備註", op: "contains", value: "急" }],
          targets: [],
          tone: "c1",
        },
      ],
    })
    expect(res.statusCode).toBe(200)

    const got = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
    })
    const layout = (
      got.json() as { layout: { conditionalFormats?: { record: unknown[]; list: unknown[] } } }
    ).layout
    expect(layout.conditionalFormats?.record).toHaveLength(1)
    expect(layout.conditionalFormats?.list).toHaveLength(1)
  })

  it("FMEA G1:tone 非受控白名單(自由 hex / 任意字串)→ 400", async () => {
    for (const tone of ["#ff0000", "rainbow"]) {
      const res = await putFormats({
        record: [{ conditions: [{ field: "登記日", op: "isEmpty" }], tone }],
        list: [],
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it("運算子限於既有 FILTER_OPERATORS(與列表篩選同源)→ 400", async () => {
    const res = await putFormats({
      record: [{ conditions: [{ field: "登記日", op: "matchesRegex", value: ".*" }], tone: "ok" }],
      list: [],
    })
    expect(res.statusCode).toBe(400)
  })

  it("空條件之規則 → 400(規則必須至少一個條件)", async () => {
    const res = await putFormats({ record: [{ conditions: [], tone: "ok" }], list: [] })
    expect(res.statusCode).toBe(400)
  })

  it("未設 conditionalFormats 仍可存 layout(既有表單零遷移)", async () => {
    const res = await putLayout(A(), { fields: {} })
    expect(res.statusCode).toBe(200)
  })
})

describe("🔴 版面樂觀鎖(#109)", () => {
  it("**兩人同改,後寫者被擋而非蓋掉整張版面**", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: `並發版面_${String(Date.now()).slice(-6)}`,
        fields: [
          { name: "甲", type: "text" },
          { name: "乙", type: "text" },
        ],
      },
    })
    const body = created.json() as { id: number; version: number; fields: { id: number }[] }
    const fid = body.id
    const a = String(body.fields[0]?.id ?? 0)
    const b = String(body.fields[1]?.id ?? 0)

    // 兩人同時載入,拿到同一個 version
    const detail = await app.inject({ method: "GET", url: `/api/forms/${fid}`, headers: A() })
    const base = (detail.json() as { version: number }).version

    const first = await app.inject({
      method: "PATCH",
      url: `/api/forms/${fid}/layout`,
      headers: A(),
      payload: { fields: { [a]: { row: 0, col: 0 } }, expectedVersion: base },
    })
    expect(first.statusCode).toBe(200)

    // 後寫者拿著同一個舊 version → 必須被擋,而不是蓋掉整張
    const second = await app.inject({
      method: "PATCH",
      url: `/api/forms/${fid}/layout`,
      headers: A(),
      payload: { fields: { [b]: { row: 5, col: 5 } }, expectedVersion: base },
    })
    expect(second.statusCode).toBe(409)
    expect((second.json() as { code: string }).code).toBe("LAYOUT_VERSION_CONFLICT")

    const after = await app.inject({ method: "GET", url: `/api/forms/${fid}/layout`, headers: A() })
    const saved = (after.json() as { layout: { fields: Record<string, unknown> } }).layout
    expect(saved.fields[a]).toEqual({ row: 0, col: 0 })
    expect(saved.fields[b]).toBeUndefined()
  })

  it("不帶 expectedVersion 時維持舊行為(既有呼叫端不受影響)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
      payload: { fields: { [String(noteFieldId)]: { row: 2, col: 2 } } },
    })
    expect(res.statusCode).toBe(200)
  })
})
