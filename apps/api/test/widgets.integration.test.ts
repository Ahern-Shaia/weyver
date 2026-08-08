import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { roles, tenants, users } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

/* 🔴 F-2 M4 小圖表。本檔盯的是三條裁定裡**會被靜默繞過**的那兩條:

   OQ-PC-12 = A|可檢視群組候選**先被來源表單權限過濾** ——
   Ragic 官方逐字「可檢視群組會列出對來源表單具有表單權限的群組」。
   這讓 widget 的可見群組**結構上不可能成為提權路徑**。
   若候選清單沒過濾,每加一個 widget 就多一個可放寬權限的地方,
   而那條路徑不會有任何錯誤訊息。

   OQ-PC-11 = A|對分組 / 聚合欄無權限時**具名 fail-closed**(照 Salesforce)——
   不能只顯示空白圖:空白圖會被當成「沒資料」。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let formId = 0
let outsiderRoleId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "1" })

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri(), 5)
  await runMigrations(pool)
  const db = createDrizzle(pool)
  tenantA =
    (
      await db
        .insert(tenants)
        .values([{ name: "圖租戶" }])
        .returning()
    )[0]?.id ?? 0
  await db.insert(users).values([{ authUserId: "w1", email: "w1@weyver.test", name: "建圖者" }])
  /* 一個對來源表單**沒有任何權限**的角色 —— 它必須選不到 */
  outsiderRoleId =
    (
      await db
        .insert(roles)
        .values([{ tenantId: tenantA, key: "outsider", name: "外部角色", depth: 0 }])
        .returning()
    )[0]?.id ?? 0

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
      name: "銷貨單",
      fields: [
        { name: "區域", type: "singleSelect", options: { choices: ["北", "南"] } },
        { name: "金額", type: "number" },
      ],
    },
  })
  formId = (form.json() as { id: number }).id
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("OQ-PC-12|可檢視群組不得成為提權路徑", () => {
  it("🔴 對來源表單無權的角色**不在候選清單裡**", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/widgets/role-candidates`,
      headers: A(),
    })
    expect(res.statusCode).toBe(200)
    const ids = (res.json() as { id: number }[]).map((r) => r.id)
    expect(ids).not.toContain(outsiderRoleId)
  })

  /* 前端過濾只是可用性,**後端才是執法** —— 直接打 API 也要擋 */
  it("🔴 硬送一個沒資格的角色 → 403,而不是靜默存進去", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/widgets`,
      headers: A(),
      payload: {
        name: "越權圖",
        dimension: "區域",
        visibleRoleIds: [outsiderRoleId],
      },
    })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { code: string }).code).toBe("WIDGET_ROLE_NOT_ELIGIBLE")
  })
})

describe("widget CRUD 與 fail-closed", () => {
  it("建立後列得出來,且可顯示(維度欄看得到)", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/widgets`,
      headers: A(),
      payload: { name: "各區筆數", dimension: "區域", chartType: "pie" },
    })
    expect(created.statusCode).toBe(201)

    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/widgets`,
      headers: A(),
    })
    const widgets = list.json() as { name: string; unavailableReason: string | null }[]
    expect(widgets.map((w) => w.name)).toContain("各區筆數")
    /* dev 為 superAdmin,欄位全可見 → 沒有不可用理由 */
    expect(widgets.find((w) => w.name === "各區筆數")?.unavailableReason).toBeNull()
  })

  /* 🔴 OQ-PC-11:維度欄不存在(等同無權/已刪)→ **具名**理由,不是空白圖。
     空白圖會被當成「沒資料」,而那是最糟的誤導 —— 使用者會據此做決策。 */
  it("🔴 分組欄看不到時回具名理由,而不是一張空白圖", async () => {
    await app.inject({
      method: "POST",
      url: `/api/forms/${String(formId)}/widgets`,
      headers: A(),
      payload: { name: "壞圖", dimension: "不存在的欄" },
    })
    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/widgets`,
      headers: A(),
    })
    const bad = (list.json() as { name: string; unavailableReason: string | null }[]).find(
      (w) => w.name === "壞圖",
    )
    expect(bad?.unavailableReason).toContain("不存在的欄")
    expect(bad?.unavailableReason).toContain("沒有存取權")
  })

  it("跨租戶讀不到(RLS + tenant 綁定)", async () => {
    const other = await app.inject({
      method: "GET",
      url: `/api/forms/${String(formId)}/widgets`,
      headers: { "x-dev-tenant": String(tenantA + 999), "x-dev-actor": "1" },
    })
    expect([403, 404]).toContain(other.statusCode)
  })
})
