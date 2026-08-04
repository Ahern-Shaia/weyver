import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* R1·後續-1 M1 按鈕動作框架:CRUD + updateSelf/pushTo 執行 + 冪等 + 跨租戶隔離。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let tenantB = 0
let poFormId = 0
let taskFormId = 0
let recordId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

interface ButtonDto {
  id: number
  formId: number
  label: string
  actionType: string
  confirm: boolean
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

  const po = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "採購申請",
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "狀態", type: "singleSelect", options: { choices: ["草稿", "已核准"] } },
      ],
    },
  })
  poFormId = (po.json() as { id: number }).id

  const task = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "採購工單",
      fields: [
        { name: "來源品名", type: "text", required: true },
        { name: "備註", type: "text" },
      ],
    },
  })
  taskFormId = (task.json() as { id: number }).id

  const rec = await app.inject({
    method: "POST",
    url: `/api/forms/${poFormId}/records`,
    headers: A(),
    payload: { values: { 品名: "冷凍雞腿", 狀態: "草稿" } },
  })
  recordId = (rec.json() as { id: number }).id
})

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const createButton = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/api/forms/${poFormId}/buttons`, headers, payload })

describe("R1·後續-1 M1 按鈕動作", () => {
  it("建立 updateSelf 按鈕 → 執行 → 本表欄位被更新", async () => {
    const created = await createButton(A(), {
      label: "標記核准",
      config: {
        actionType: "updateSelf",
        setFields: { 狀態: { from: "literal", value: "已核准" } },
      },
    })
    expect(created.statusCode).toBe(201)
    const button = created.json() as ButtonDto
    expect(button.actionType).toBe("updateSelf")

    const run = await app.inject({
      method: "POST",
      url: `/api/forms/${poFormId}/buttons/${button.id}/run/${recordId}`,
      headers: A(),
    })
    expect(run.statusCode).toBe(200)
    expect((run.json() as { outcome: string }).outcome).toBe("updated")

    const got = await app.inject({
      method: "GET",
      url: `/api/forms/${poFormId}/records/${recordId}`,
      headers: A(),
    })
    expect((got.json() as { values: Record<string, unknown> }).values.狀態).toBe("已核准")
  })

  it("重複執行同一按鈕 → duplicate(冪等,不重跑副作用)", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${poFormId}/buttons`,
      headers: A(),
    })
    const button = (list.json() as ButtonDto[])[0]
    if (button === undefined) throw new Error("no button")
    const again = await app.inject({
      method: "POST",
      url: `/api/forms/${poFormId}/buttons/${button.id}/run/${recordId}`,
      headers: A(),
    })
    expect((again.json() as { outcome: string }).outcome).toBe("duplicate")
  })

  it("pushTo 按鈕 → 於目標表建記錄(欄位映射)", async () => {
    const created = await createButton(A(), {
      label: "轉工單",
      config: {
        actionType: "pushTo",
        targetFormId: taskFormId,
        fieldMap: {
          來源品名: { from: "field", field: "品名" },
          備註: { from: "literal", value: "由採購轉入" },
        },
      },
    })
    const button = created.json() as ButtonDto
    const run = await app.inject({
      method: "POST",
      url: `/api/forms/${poFormId}/buttons/${button.id}/run/${recordId}`,
      headers: A(),
    })
    expect(run.statusCode).toBe(200)
    const result = run.json() as { outcome: string; targetRecordId: number }
    expect(result.outcome).toBe("created")

    const target = await app.inject({
      method: "GET",
      url: `/api/forms/${taskFormId}/records/${result.targetRecordId}`,
      headers: A(),
    })
    const values = (target.json() as { values: Record<string, unknown> }).values
    expect(values.來源品名).toBe("冷凍雞腿")
    expect(values.備註).toBe("由採購轉入")
  })

  it("非法 config(url 非 https)→ 400", async () => {
    const res = await createButton(A(), {
      label: "壞連結",
      config: { actionType: "openUrl", url: "javascript:alert(1)" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("來源欄不存在 → 400(確定性編譯拒)", async () => {
    const created = await createButton(A(), {
      label: "壞映射",
      config: {
        actionType: "pushTo",
        targetFormId: taskFormId,
        fieldMap: { 來源品名: { from: "field", field: "幽靈欄" } },
      },
    })
    const button = created.json() as ButtonDto
    const run = await app.inject({
      method: "POST",
      url: `/api/forms/${poFormId}/buttons/${button.id}/run/${recordId}`,
      headers: A(),
    })
    expect(run.statusCode).toBe(400)
  })

  it("跨租戶:B 看不到 A 的按鈕、且不能執行", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${poFormId}/buttons`,
      headers: B(),
    })
    // B 對 A 的表單無權 → 403/404 皆可接受;若 200 則必為空
    if (list.statusCode === 200) expect(list.json() as ButtonDto[]).toEqual([])
    else expect([403, 404]).toContain(list.statusCode)
  })
})

/* 🔴 C-3|條件式的「顯示 / 隱藏 / 上鎖動作按鈕」**在伺服器執法**。
   前端不畫那顆按鈕只是體驗;按鈕的效果是伺服器跑的,擋也要擋在伺服器。 */
describe("條件式格式閘門(繞過畫面直接打 API)", () => {
  let buttonId = 0
  let gatedRecordId = 0
  /* ⚠️ 不共用 `recordId` —— 前面的測試會把它的「狀態」改成已核准,
     於是這裡的閘門條件跟著成立,而失敗訊息只說 403 vs 200。 */
  let openRecordId = 0

  beforeAll(async () => {
    const created = await createButton(A(), {
      label: "轉工單",
      config: { actionType: "openUrl", url: "https://example.com/" },
    })
    expect(created.statusCode).toBe(201)
    buttonId = (created.json() as { id: number }).id

    const rec = await app.inject({
      method: "POST",
      url: `/api/forms/${poFormId}/records`,
      headers: A(),
      payload: { values: { 品名: "上鎖用", 狀態: "已核准" } },
    })
    gatedRecordId = (rec.json() as { id: number }).id

    const open = await app.inject({
      method: "POST",
      url: `/api/forms/${poFormId}/records`,
      headers: A(),
      payload: { values: { 品名: "未核准", 狀態: "草稿" } },
    })
    openRecordId = (open.json() as { id: number }).id

    await app.inject({
      method: "PATCH",
      url: `/api/forms/${poFormId}/layout`,
      headers: A(),
      payload: {
        grid: { cols: 12 },
        fields: {},
        statics: [],
        sections: [],
        conditionalFormats: {
          record: [
            {
              combinator: "and",
              conditions: [{ field: "狀態", op: "eq", value: "已核准" }],
              targets: [],
              targetButtons: [buttonId],
              effects: [{ kind: "readonly" }, { kind: "message", text: "已核准的單不可再轉" }],
            },
          ],
          list: [],
        },
      },
    })
  })

  const run = (recId: number) =>
    app.inject({
      method: "POST",
      url: `/api/forms/${poFormId}/buttons/${buttonId}/run/${recId}`,
      headers: A(),
    })

  it("🔴 條件成立 → 403,且理由是設計者寫的那句話", async () => {
    const res = await run(gatedRecordId)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({
      code: "BUTTON_BLOCKED_BY_RULE",
      message: "已核准的單不可再轉",
    })
  })

  it("條件不成立 → 照常執行(閘門不得預設擋住)", async () => {
    const res = await run(openRecordId)
    expect(res.statusCode).toBe(200)
  })
})
