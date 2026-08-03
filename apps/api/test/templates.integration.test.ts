import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { TEMPLATE_PACKS } from "../src/templates/packs.js"
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

/* 🔴 M4|**首發範本集的每一個包都要真的套得起來**。

   包的 schema 在 module load 時就驗了,但**欄位 options 要到套用時才驗**
   (`createFormSpecSchema`)—— 也就是說一個寫錯的 `singleSelect.choices` 或
   `formula.expression` 在單元測試裡完全看不出來,而使用者按下去才炸。
   這正是本專案反覆踩到的形狀:**有資料、沒人驗過**。 */
describe("首發範本集", () => {
  it("九個包全部套得起來(逐包實建再收掉)", async () => {
    expect(TEMPLATE_PACKS.length).toBeGreaterThanOrEqual(8)
    for (const pack of TEMPLATE_PACKS) {
      const unique = {
        ...pack,
        forms: pack.forms.map((f) => ({ ...f, name: `${f.name}_${String(Date.now()).slice(-6)}` })),
      }
      const res = await templates.apply(tenantA, unique, 1, { withRecords: true })
      expect(res.formIds.length, `${pack.key} 應建出 ${String(pack.forms.length)} 張`).toBe(
        pack.forms.length,
      )
    }
  }, 120_000)

  /* OQ-TPL-8 = C:主軸是職能不是產業。
     ⚠️ 這條看起來像在測資料,實際在測**定位** —— v0.1 的首發集四個裡三個是食品,
     而 docs/04 v1.5 明文「多產業通用、非食品業垂直」。退化時沒有任何技術訊號。 */
  it("🔴 通用職能範本必須多於產業範本(否則用範本庫把定位講反了)", () => {
    const generic = TEMPLATE_PACKS.filter((p) => p.industry === undefined)
    const industry = TEMPLATE_PACKS.filter((p) => p.industry !== undefined)
    expect(generic.length).toBeGreaterThan(industry.length)
  })
})

/* 🔴 同一個範本套第二次 —— **實走時抓到的真缺陷**。

   原本會撞表單名唯一,而回給使用者的是「internal error」:
   使用者的意圖通常是「我要再一份」(不同部門 / 不同年度),
   而他得到的是一句什麼都沒說的錯誤。
   改為自動加序號,**並把改了哪些名字回報出去** —— 靜默改名跟靜默不改一樣糟
   (使用者會以為套用失敗了,因為找不到他預期的那個名字)。 */
describe("重複套用同一個範本", () => {
  it("🔴 第二次套用不失敗,同名自動加序號並回報", async () => {
    const pack = templatePackSchema.parse({
      key: "twice",
      version: "1.0",
      name: "重複",
      description: "",
      forms: [
        {
          ref: "a",
          name: `重複表_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "甲", type: "text" }],
        },
      ],
    })
    const first = await templates.apply(tenantA, pack, 1)
    expect(first.renamed).toEqual([])

    const second = await templates.apply(tenantA, pack, 1)
    expect(second.formIds).toHaveLength(1)
    expect(second.renamed[0]).toContain("(2)")
  })
})

/* 🔴 OQ-TPL-3 = B|範本要帶**版面**,不只欄位。

   「只帶欄位」交付不出「打開就能用」的觀感,而那正是範本的價值 ——
   套出來若是一排預設直排欄位,跟使用者自己建一張空白表沒兩樣。
   版面在範本裡以**欄位顯示名**為 key(id 還不存在),此測試釘的是那層轉換。 */
describe("版面帶入", () => {
  it("🔴 範本的版面套用後以真實 field id 落在 form_def.layout", async () => {
    const stamp = String(Date.now()).slice(-5)
    const pack = templatePackSchema.parse({
      key: "with-layout",
      version: "1.0",
      name: "帶版面",
      description: "",
      forms: [
        {
          ref: "a",
          name: `版面表_${stamp}`,
          fields: [
            { name: "甲", type: "text" },
            { name: "乙", type: "text" },
          ],
          layout: { 甲: { row: 0, col: 0, colSpan: 6 }, 乙: { row: 0, col: 6, colSpan: 6 } },
        },
      ],
    })
    const res = await templates.apply(tenantA, pack, 1)
    const formId = res.formIds[0] ?? 0

    const r = await pool.query("SELECT layout FROM form_def WHERE id = $1", [formId])
    const layout = (r.rows[0] as { layout: { fields: Record<string, { col: number }> } }).layout
    const ids = await pool.query(
      "SELECT id, name FROM field_def WHERE form_id = $1 AND deleted_at IS NULL",
      [formId],
    )
    const byName = new Map(
      (ids.rows as { id: string; name: string }[]).map((x) => [x.name, String(x.id)]),
    )
    /* key 必須是**真實 id** 不是欄位名 —— 存欄位名的話 layout 讀取端一個也對不上,
       而畫面看起來只是「排版沒生效」,指不到原因 */
    expect(layout.fields[byName.get("甲") ?? ""]?.col).toBe(0)
    expect(layout.fields[byName.get("乙") ?? ""]?.col).toBe(6)
  })

  /* 範本改版時欄位可能改名 —— 為了一個排版問題讓整包回滾不划算(表已建好且可用),
     但略過要出聲(service 記 warn),不能靜默少做。 */
  it("版面指到不存在的欄位名 → 略過該欄,不讓整包失敗", async () => {
    const pack = templatePackSchema.parse({
      key: "stale-layout",
      version: "1.0",
      name: "舊版面",
      description: "",
      forms: [
        {
          ref: "a",
          name: `舊版面_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "甲", type: "text" }],
          layout: { 甲: { row: 0, col: 0 }, 已改名的欄: { row: 1, col: 0 } },
        },
      ],
    })
    const res = await templates.apply(tenantA, pack, 1)
    expect(res.formIds).toHaveLength(1)
  })
})
