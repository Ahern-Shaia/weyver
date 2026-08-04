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
import { PG_TEST_IMAGE } from "./pg-image.js"

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
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  tenantId =
    (
      await db
        .insert(tenants)
        .values([{ name: "廠 A" }])
        .returning()
    )[0]?.id ?? 0

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

/* 🔴 旁路第 4 項:**公式 / 計算欄引用隱藏欄**(對照 CVE-2019-11780 ——
   Odoo 可經 non-stored computed field 繞過存取權)。

   讀取路徑是「先算公式,再遮罩隱藏欄」。遮罩刪的是**隱藏欄自己的值**,
   而公式欄是**另一個欄**,不會被刪 —— 但它的值是用隱藏欄算出來的。
   `月薪` 隱藏、`年薪 = 月薪 * 12` 沒隱藏 → 一除以 12 就還原。**遮了等於沒遮。** */
describe("旁路:公式欄引用隱藏欄", () => {
  let annualFieldId = 0
  let doubledFieldId = 0

  beforeAll(async () => {
    const admin = { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" }
    for (const [name, expr] of [
      ["年薪", "{月薪} * 12"],
      /* ⚠️ 傳遞閉包:這一欄**沒有直接引用**隱藏欄,只引用了另一個公式欄 —— 但一樣洩漏 */
      ["年薪兩倍", "{年薪} * 2"],
    ]) {
      const r = await app.inject({
        method: "POST",
        url: `/api/forms/${formId}/fields`,
        headers: admin,
        payload: { name, type: "formula", options: { expression: expr } },
      })
      expect(r.statusCode).toBeLessThan(300)
    }
    const detail = await app.inject({ method: "GET", url: `/api/forms/${formId}`, headers: admin })
    const fields = (detail.json() as { fields: { id: number; name: string }[] }).fields
    annualFieldId = fields.find((f) => f.name === "年薪")?.id ?? 0
    doubledFieldId = fields.find((f) => f.name === "年薪兩倍")?.id ?? 0
    expect(annualFieldId).toBeGreaterThan(0)
    expect(doubledFieldId).toBeGreaterThan(0)
  }, 60_000)

  it("admin 看得到公式值(先證明公式真的有在算,否則下面的斷言是假綠)", async () => {
    const res = await records.listRecords(
      tenantId,
      formId,
      { filters: [], sort: [], limit: 50 },
      undefined,
    )
    const values = res.records.map((r) => r.values)
    expect(values.some((v) => v["年薪"] !== undefined && v["年薪"] !== null)).toBe(true)
  })

  it("🔴 隱藏月薪的人,**看不到年薪** —— 否則除以 12 就還原了", async () => {
    const res = await records.listRecords(
      tenantId,
      formId,
      { filters: [], sort: [], limit: 50 },
      limitedPerms(),
    )
    for (const r of res.records) {
      expect(r.values).not.toHaveProperty("月薪")
      expect(r.values).not.toHaveProperty("年薪")
    }
  })

  it("🔴 **傳遞閉包**:只引用公式欄、沒直接引用隱藏欄的公式也要遮", async () => {
    const res = await records.listRecords(
      tenantId,
      formId,
      { filters: [], sort: [], limit: 50 },
      limitedPerms(),
    )
    for (const r of res.records) expect(r.values).not.toHaveProperty("年薪兩倍")
  })

  it("🔴 單筆讀取走的是另一條路徑,同樣不得洩", async () => {
    const list = await records.listRecords(
      tenantId,
      formId,
      { filters: [], sort: [], limit: 50 },
      undefined,
    )
    const id = list.records[0]?.id ?? 0
    expect(id).toBeGreaterThan(0)
    const one = await records.getRecord(tenantId, formId, id, limitedPerms())
    expect(one.values).not.toHaveProperty("月薪")
    expect(one.values).not.toHaveProperty("年薪")
    expect(one.values).not.toHaveProperty("年薪兩倍")
  })

  it("沒隱藏任何欄的人不受影響 —— 修法不得把功能一起關掉", async () => {
    const res = await records.listRecords(
      tenantId,
      formId,
      { filters: [], sort: [], limit: 50 },
      undefined,
    )
    expect(res.records.some((r) => r.values["年薪兩倍"] !== undefined)).toBe(true)
  })
})

/* 🔴 R1·LNK M1|連結欄候選清單的權限。

   **來源表單的權限不蘊含目標表單的權限** —— 你在填採購單不代表你看得到供應商。
   而候選清單天生是一個「把整張目標表念出來」的端點,漏檢就是跨表單資料掃描器。 */
describe("連結欄候選清單:跨表單權限", () => {
  let linkFormId = 0
  let linkFieldId = 0

  beforeAll(async () => {
    const admin = { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" }
    const created = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: admin,
      payload: {
        name: "採購單",
        fields: [
          { name: "單號", type: "text" },
          { name: "員工", type: "link", options: { targetFormId: formId } },
        ],
      },
    })
    expect(created.statusCode).toBeLessThan(300)
    const body = created.json() as { id: number; fields: { id: number; name: string }[] }
    linkFormId = body.id
    linkFieldId = body.fields.find((f) => f.name === "員工")?.id ?? 0
    expect(linkFieldId).toBeGreaterThan(0)
  }, 60_000)

  const call = (headers: Record<string, string>, q = "") =>
    app.inject({
      method: "GET",
      url: `/api/forms/${linkFormId}/fields/${linkFieldId}/link-options?q=${encodeURIComponent(q)}`,
      headers,
    })

  it("admin 拿得到候選,且 label 是標題不是 id", async () => {
    const res = await call({ "x-dev-tenant": String(tenantId), "x-dev-actor": "1" })
    expect(res.statusCode).toBe(200)
    const { options } = res.json() as { options: { id: number; label: string }[] }
    expect(options.length).toBeGreaterThan(0)
    expect(options.map((o) => o.label)).toContain("乙")
  })

  it("搜尋只縮到相符的那些", async () => {
    const res = await call({ "x-dev-tenant": String(tenantId), "x-dev-actor": "1" }, "乙")
    const { options } = res.json() as { options: { label: string }[] }
    expect(options).toHaveLength(1)
    expect(options[0]?.label).toBe("乙")
  })

  /* 🔴 這一條是本模組的核心防線。dev 車道恆為 admin,故直接對 service 驗 ——
     用一個「對來源表單有 view、對目標表單沒有」的權限物件。 */
  it("🔴 對目標表單沒有 view 權 → 拒絕,不得變成跨表單掃描器", async () => {
    const { LinkOptionsService } = await import(
      "../src/form-engine/relations/link-options.service.js"
    )
    const svc = app.get(LinkOptionsService)
    const onlySource = new EffectivePermissions(
      false,
      new Map([[linkFormId, new Set(["view" as const])]]),
      new Map(),
      new Set(),
    )
    await expect(
      svc.listOptions(tenantId, linkFormId, linkFieldId, "", 20, onlySource),
    ).rejects.toThrow()
  })

  /* 標題欄被遮時回 `#id` —— **不是空白**。空白會讓人以為那筆沒資料,
     而他其實是沒權限(同 pivot 的裁定:寧可具名,不要靜默)。 */
  it("標題欄對此人隱藏 → label 退回 #id,且不提供搜尋", async () => {
    const { LinkOptionsService } = await import(
      "../src/form-engine/relations/link-options.service.js"
    )
    const svc = app.get(LinkOptionsService)
    const detail = await app.inject({
      method: "GET",
      url: `/api/forms/${formId}`,
      headers: { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" },
    })
    const nameFieldId =
      (detail.json() as { fields: { id: number; name: string }[] }).fields.find(
        (f) => f.name === "姓名",
      )?.id ?? 0
    const hiddenTitle = new EffectivePermissions(
      false,
      new Map([
        [linkFormId, new Set(["view" as const])],
        [formId, new Set(["view" as const])],
      ]),
      new Map([[nameFieldId, "hidden" as const]]),
      new Set(),
    )
    const options = await svc.listOptions(tenantId, linkFormId, linkFieldId, "", 20, hiddenTitle)
    expect(options.length).toBeGreaterThan(0)
    for (const o of options) expect(o.label).toMatch(/^#\d+$/)
  })
})

/* 🔴 R1·LNK M2|Load 帶入。

   Ragic `doc/14` 逐字:「選擇顧客姓名之後,**會自動帶出**該顧客對應的其他資訊」。
   帶入 = 把來源記錄的欄值複製過來 —— 那是一條**把別張表的資料搬到這張表**的路徑,
   所以權限與遮罩必須跟著走,否則它就是 `link-options` 之外的第二個洩漏面。 */
describe("Load 帶入", () => {
  let poFormId = 0
  let linkFieldId = 0
  let noteFieldId = 0
  let salaryCopyFieldId = 0

  beforeAll(async () => {
    const admin = { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" }
    const created = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: admin,
      payload: {
        name: "帶入測試單",
        fields: [
          { name: "員工", type: "link", options: { targetFormId: formId } },
          { name: "帶入姓名", type: "text" },
          { name: "帶入月薪", type: "money" },
        ],
      },
    })
    const body = created.json() as { id: number; fields: { id: number; name: string }[] }
    poFormId = body.id
    linkFieldId = body.fields.find((f) => f.name === "員工")?.id ?? 0
    noteFieldId = body.fields.find((f) => f.name === "帶入姓名")?.id ?? 0
    salaryCopyFieldId = body.fields.find((f) => f.name === "帶入月薪")?.id ?? 0

    const detail = await app.inject({ method: "GET", url: `/api/forms/${formId}`, headers: admin })
    const src = (detail.json() as { fields: { id: number; name: string }[] }).fields
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${poFormId}/fields/${linkFieldId}/load-map`,
      headers: admin,
      payload: {
        loadMap: [
          { fromFieldId: src.find((f) => f.name === "姓名")?.id ?? 0, toFieldId: noteFieldId },
          { fromFieldId: salaryFieldId, toFieldId: salaryCopyFieldId },
        ],
      },
    })
    expect(res.statusCode).toBeLessThan(300)
  }, 60_000)

  const load = async (recordId: number, perms?: EffectivePermissions) => {
    const { LinkOptionsService } = await import(
      "../src/form-engine/relations/link-options.service.js"
    )
    return app.get(LinkOptionsService).loadValues(tenantId, poFormId, linkFieldId, recordId, perms)
  }

  it("admin 選了記錄 → 對映的欄值都帶進來(以**本地欄名**為鍵,前端可直接 spread)", async () => {
    const values = await load(1)
    expect(values["帶入姓名"]).toBe("甲")
    expect(values["帶入月薪"]).toBe("30000.0000")
  })

  /* 🔴 這一條是本模組的核心防線:帶入不得繞過欄位級遮罩。
     `月薪` 對此人隱藏 → `getRecord` 根本不會回那個鍵 → 也就帶不進來。 */
  it("🔴 來源欄對此人隱藏 → 該欄不帶入(其餘照帶)", async () => {
    const values = await load(1, limitedPerms())
    expect(values["帶入姓名"]).toBe("甲")
    expect(values).not.toHaveProperty("帶入月薪")
  })

  it("🔴 對目標表單沒有 view 權 → 整個帶入被拒", async () => {
    const onlySource = new EffectivePermissions(
      false,
      new Map([[poFormId, new Set(["view" as const])]]),
      new Map(),
      new Set(),
    )
    await expect(load(1, onlySource)).rejects.toThrow()
  })

  /* 🔴 綁了租戶不等於這個欄位屬於這張表。少了歸屬檢查,帶著自己有 design 權的 formId
     就能把**任意兩個欄位**配成對映,而下次有人選記錄時那個值就會被讀出來。 */
  it("🔴 設定對映時兩端都要驗歸屬 —— 拿別張表的欄位當目標必須被拒", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${poFormId}/fields/${linkFieldId}/load-map`,
      headers: { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" },
      /* toFieldId 指向來源表單的欄位(不屬於 poForm) */
      payload: { loadMap: [{ fromFieldId: salaryFieldId, toFieldId: salaryFieldId }] },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it("連結欄自己不能當帶入目標 —— 會把使用者剛選的那筆蓋掉", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/forms/${poFormId}/fields/${linkFieldId}/load-map`,
      headers: { "x-dev-tenant": String(tenantId), "x-dev-actor": "1" },
      payload: { loadMap: [{ fromFieldId: salaryFieldId, toFieldId: linkFieldId }] },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})
