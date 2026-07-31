import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"

/* R1·後續-2 M1:label_def CRUD + config 欄名/數量欄驗證 + 跨租戶 + layout.print 加法。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let tenantB = 0
let formId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

interface LabelDto {
  id: number
  formId: number
  name: string
  config: { size: { widthMm: number }; tile: boolean; items: { field: string }[] }
  position: number
}

const baseConfig = {
  size: { widthMm: 50, heightMm: 30 },
  tile: true,
  gapMm: 2,
  items: [{ field: "品名" }, { field: "批號", asQr: true }],
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
      name: "進貨憑單",
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "批號", type: "barcode" },
        { name: "張數", type: "number" },
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

const createLabel = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/api/forms/${formId}/labels`, headers, payload })

describe("R1·後續-2 M1 label_def", () => {
  it("建立標籤定義 → 201 + 清單可見", async () => {
    const res = await createLabel(A(), { name: "進貨標籤", config: baseConfig })
    expect(res.statusCode).toBe(201)
    const label = res.json() as LabelDto
    expect(label.config.items).toHaveLength(2)
    expect(label.config.tile).toBe(true)

    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/labels`,
      headers: A(),
    })
    expect((list.json() as LabelDto[]).some((l) => l.name === "進貨標籤")).toBe(true)
  })

  it("items 引用不存在欄位 → 400", async () => {
    const res = await createLabel(A(), {
      name: "壞標籤",
      config: { ...baseConfig, items: [{ field: "幽靈欄" }] },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { code: string }).code).toBe("INVALID_LABEL_CONFIG")
  })

  it("copiesField 非數值欄 → 400", async () => {
    const res = await createLabel(A(), {
      name: "壞份數",
      config: { ...baseConfig, copiesField: "品名" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("copiesField 為數值欄 → 通過", async () => {
    const res = await createLabel(A(), {
      name: "份數標籤",
      config: { ...baseConfig, copiesField: "張數" },
    })
    expect(res.statusCode).toBe(201)
  })

  it("尺寸越界 → 400(Zod)", async () => {
    const res = await createLabel(A(), {
      name: "超大",
      config: { ...baseConfig, size: { widthMm: 500, heightMm: 30 } },
    })
    expect(res.statusCode).toBe(400)
  })

  it("更新 + 刪除標籤", async () => {
    const created = await createLabel(A(), { name: "待改", config: baseConfig })
    const id = (created.json() as LabelDto).id
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/labels/${id}`,
      headers: A(),
      payload: { name: "已改" },
    })
    expect((patched.json() as LabelDto).name).toBe("已改")

    const del = await app.inject({
      method: "DELETE",
      url: `/api/forms/${formId}/labels/${id}`,
      headers: A(),
    })
    expect(del.statusCode).toBe(204)
    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/labels`,
      headers: A(),
    })
    expect((list.json() as LabelDto[]).some((l) => l.id === id)).toBe(false)
  })

  it("跨租戶:B 看不到 A 的標籤(或被權限擋)", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/labels`,
      headers: B(),
    })
    if (list.statusCode === 200) expect(list.json() as LabelDto[]).toEqual([])
    else expect([403, 404]).toContain(list.statusCode)
  })

  it("layout.print 加法:可存頁首/頁尾/換頁列;既有 layout 不破", async () => {
    const put = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
      payload: {
        fields: {},
        print: { headerRows: [0], footerRows: [5], pageBreakAfterRows: [3] },
      },
    })
    expect(put.statusCode).toBe(200)
    const got = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
    })
    const layout = (got.json() as { layout: { print?: { headerRows: number[] } } }).layout
    expect(layout.print?.headerRows).toEqual([0])

    // 不帶 print 的舊 payload 仍可存(加法 optional)
    const legacy = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/layout`,
      headers: A(),
      payload: { fields: {} },
    })
    expect(legacy.statusCode).toBe(200)
  })
})
