import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { templatePackSchema } from "../src/templates/template-specs.js"
import { TemplateService } from "../src/templates/template.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·TPL M1|套用範本包。

   兩個承重點:
   ① **包內以相對代號互指**(OQ-TPL-2=A)—— 套用後 link 要真的指到同包內那張表,
      而不是一個壞掉的、不會報錯的關聯。
   ② **全成或全不成**(OQ-TPL-5=A)—— `createForm` 是多階段的,沒辦法包進單一 tx,
      故以補償刪除達成。**半套的應用最糟**:使用者沒看過完整版,看不出來少了什麼。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let templates: TemplateService
let tenantA = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const rows = await createDrizzle(pool)
    .insert(tenants)
    .values([{ name: "範本租戶" }])
    .returning()
  tenantA = rows[0]?.id ?? 0

  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = container.getConnectionUri()
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  templates = app.get(TemplateService)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

const formCount = async (): Promise<number> => {
  const r = await pool.query(
    "SELECT count(*)::int AS n FROM form_def WHERE tenant_id = $1 AND deleted_at IS NULL",
    [tenantA],
  )
  return (r.rows[0] as { n: number }).n
}

describe("套用範本包", () => {
  it("🔴 包內的 link 套用後指到同包內那張表(相對代號解析)", async () => {
    const pack = templatePackSchema.parse({
      key: "purchase",
      version: "1.0",
      name: "請購",
      description: "",
      forms: [
        {
          ref: "vendors",
          name: `供應商_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "名稱", type: "text" }],
        },
        {
          ref: "orders",
          name: `請購單_${String(Date.now()).slice(-5)}`,
          fields: [
            { name: "單號", type: "text" },
            { name: "供應商", type: "link", targetRef: "vendors" },
          ],
        },
      ],
    })
    const res = await templates.apply(tenantA, pack, 1)
    expect(res.formIds).toHaveLength(2)

    const field = await pool.query(
      "SELECT options FROM field_def WHERE tenant_id = $1 AND form_id = $2 AND name = '供應商'",
      [tenantA, res.refMap.orders],
    )
    const options = (field.rows[0] as { options: { targetFormId?: number } }).options
    /* 這一條就是 OQ-TPL-2=A 的全部理由:存真實 id 的話,漏改一處只會變成
       一個壞掉的關聯,而且不會報錯 */
    expect(options.targetFormId).toBe(res.refMap.vendors)
  })

  it("🔴 中途失敗 → 補償刪除,不留半套的應用(OQ-TPL-5)", async () => {
    const before = await formCount()
    const pack = templatePackSchema.parse({
      key: "broken",
      version: "1.0",
      name: "壞包",
      description: "",
      forms: [
        {
          ref: "good",
          name: `好表_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "甲", type: "text" }],
        },
        /* 第二張的欄位型別合法但 options 不合法 → `createFormSpecSchema` 會擋,
           而此時第一張**已經建好了** */
        {
          ref: "bad",
          name: `壞表_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "乙", type: "formula", options: {} }],
        },
      ],
    })
    await expect(templates.apply(tenantA, pack, 1)).rejects.toThrow()
    /* 第一張必須被收掉 —— 使用者沒看過完整版,留一張下來他看不出來少了什麼 */
    expect(await formCount()).toBe(before)
  })

  it("ref 打錯 → 在建任何表之前就擋下(沒有副作用要補償)", async () => {
    const before = await formCount()
    const pack = templatePackSchema.parse({
      key: "badref",
      version: "1.0",
      name: "壞 ref",
      description: "",
      forms: [
        { ref: "a", name: "甲表", fields: [{ name: "關聯", type: "link", targetRef: "ghost" }] },
      ],
    })
    await expect(templates.apply(tenantA, pack, 1)).rejects.toThrow(/ghost/)
    expect(await formCount()).toBe(before)
  })
})
