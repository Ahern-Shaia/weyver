import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { ImportService } from "../src/form-engine/import/import.service.js"
import { importPlanSchema } from "../src/form-engine/import/import-specs.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 #106 匯入既有表單。深研見 docs/modules/R1/import-to-existing-form.md §0。
   Ragic 官方的匯入主入口是「既有 sheet → Tools → Import Data From File」——
   遷移後客戶每天做的是這件事,而本平台原本完全沒有。 */

const ACTOR = 1
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let imports: ImportService
let knexDestroy: () => Promise<void>
let tenantA = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  const tenantDb = new TenantDb(db)
  const metadata = new MetadataService(db, tenantDb)
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)
  imports = new ImportService(tenantDb, metadata, records)
}, 120_000)

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

/* 客戶主檔:客戶編號為唯一值(可當比對鍵) */
async function customerForm(name: string, unique = true): Promise<number> {
  const { form } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name,
      fields: [
        { name: "客戶編號", type: "text", unique },
        { name: "客戶名稱", type: "text" },
        { name: "電話", type: "text" },
      ],
    }),
    ACTOR,
  )
  return form.id
}

const plan = (over: Record<string, unknown>) =>
  importPlanSchema.parse({
    policy: "upsert",
    matchFields: ["客戶編號"],
    mapping: { 編號: "客戶編號", 名稱: "客戶名稱", 電話: "電話" },
    rows: [],
    ...over,
  })

describe("🔴 upsert 決策表:阻擋條件(#106)", () => {
  it("**比對欄位沒有唯一值設定 → 擋** —— NocoDB #3438 正是未強制而讓主鍵重複", async () => {
    const formId = await customerForm("無唯一鍵", false)
    const result = await imports.plan(tenantA, formId, plan({ rows: [{ 編號: "A001" }] }))
    expect(result.blockers.map((b) => b.code)).toContain("KEY_NOT_UNIQUE")
  })

  it("**檔案內 key 重複 → 預設擋** —— PG 的 ON CONFLICT 遇到會整句爆錯", async () => {
    const formId = await customerForm("檔內重複")
    const result = await imports.plan(
      tenantA,
      formId,
      plan({
        rows: [
          { 編號: "A001", 名稱: "甲" },
          { 編號: "A001", 名稱: "乙" },
        ],
      }),
    )
    expect(result.blockers.map((b) => b.code)).toContain("DUPLICATE_KEY_IN_FILE")
  })

  it("first_wins 時檔內重複不再擋,後續同 key 列標為 skip", async () => {
    const formId = await customerForm("檔內重複可選")
    const result = await imports.plan(
      tenantA,
      formId,
      plan({
        duplicateInFile: "first_wins",
        rows: [
          { 編號: "A001", 名稱: "甲" },
          { 編號: "A001", 名稱: "乙" },
        ],
      }),
    )
    expect(result.blockers).toEqual([])
    expect(result.totals.skipped).toBe(1)
  })

  it("對映到不存在的欄位 → 擋", async () => {
    const formId = await customerForm("欄位不存在")
    const result = await imports.plan(
      tenantA,
      formId,
      plan({ mapping: { 編號: "客戶編號", 亂七八糟: "不存在的欄" }, rows: [{ 編號: "A" }] }),
    )
    expect(result.blockers.map((b) => b.code)).toContain("UNKNOWN_FIELD")
  })
})

describe("🔴 upsert 決策表:四政策(#106)", () => {
  it("upsert:命中則更新、未命中則新增", async () => {
    const formId = await customerForm("政策upsert")
    await records.createRecord(tenantA, formId, { 客戶編號: "A001", 客戶名稱: "舊名" }, ACTOR)

    const p = plan({
      rows: [
        { 編號: "A001", 名稱: "新名" },
        { 編號: "A002", 名稱: "新客戶" },
      ],
    })
    const preview = await imports.plan(tenantA, formId, p)
    expect(preview.totals).toMatchObject({ toUpdate: 1, toInsert: 1 })

    const done = await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)
    expect(done).toMatchObject({ inserted: 1, updated: 1 })
  })

  it("**update_only:未命中要報錯,不得靜默略過** —— 靜默略過是「以為匯入成功卻沒生效」的來源", async () => {
    const formId = await customerForm("政策updateonly")
    const result = await imports.plan(
      tenantA,
      formId,
      plan({ policy: "update_only", rows: [{ 編號: "不存在", 名稱: "x" }] }),
    )
    expect(result.totals.errors).toBe(1)
    expect(result.rowErrors[0]?.errorCode).toBe("NO_MATCH")
  })

  it("insert_new_only:命中則跳過不覆蓋既有資料", async () => {
    const formId = await customerForm("政策insertnew")
    await records.createRecord(tenantA, formId, { 客戶編號: "A001", 客戶名稱: "原本的" }, ACTOR)
    const p = plan({ policy: "insert_new_only", rows: [{ 編號: "A001", 名稱: "不該蓋掉" }] })
    const preview = await imports.plan(tenantA, formId, p)
    expect(preview.totals.skipped).toBe(1)

    await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)
    const list = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 10 })
    expect(list.records[0]?.values.客戶名稱).toBe("原本的")
  })
})

describe("🔴 有映射但儲存格空白:預設保留原值(#106)", () => {
  it("**空白格預設不覆蓋** —— Shopify 官方是「overwritten as blank」且無開關,是真實事故來源", async () => {
    const formId = await customerForm("空白保留")
    await records.createRecord(
      tenantA,
      formId,
      { 客戶編號: "A001", 客戶名稱: "王先生", 電話: "0912345678" },
      ACTOR,
    )
    const p = plan({ rows: [{ 編號: "A001", 名稱: "王先生", 電話: "" }] })
    const preview = await imports.plan(tenantA, formId, p)
    await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)

    const list = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 10 })
    expect(list.records[0]?.values.電話).toBe("0912345678")
  })

  it("blankPolicy=clear 才清空,且 dry-run 要報出將清空幾個欄位", async () => {
    const formId = await customerForm("空白清空")
    await records.createRecord(
      tenantA,
      formId,
      { 客戶編號: "A001", 客戶名稱: "王先生", 電話: "0912345678" },
      ACTOR,
    )
    const p = plan({ blankPolicy: "clear", rows: [{ 編號: "A001", 名稱: "王先生", 電話: "" }] })
    const preview = await imports.plan(tenantA, formId, p)
    expect(preview.impact.fieldsToClear).toBe(1)

    await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)
    const list = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 10 })
    expect(list.records[0]?.values.電話).toBeNull()
  })
})

describe("🔴 no-op 偵測(業界無一家做,#106)", () => {
  it("**值完全沒變就不寫入** —— 不動 updated_at / 稽核 / 通知", async () => {
    const formId = await customerForm("noop")
    const created = await records.createRecord(
      tenantA,
      formId,
      { 客戶編號: "A001", 客戶名稱: "王先生" },
      ACTOR,
    )
    const p = plan({ rows: [{ 編號: "A001", 名稱: "王先生" }] })
    const preview = await imports.plan(tenantA, formId, p)
    expect(preview.totals).toMatchObject({ unchanged: 1, toUpdate: 0 })

    await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)
    const after = await records.getRecord(tenantA, formId, created.id)
    // version 未動 = 真的沒寫入
    expect(after.version).toBe(created.version)
  })
})

describe("🔴 planHash:所見即所得(#106)", () => {
  it("**設定在預覽後被改過 → commit 拒絕** —— 防「看的是 A 檔、送的是 B 檔」", async () => {
    const formId = await customerForm("planhash")
    const p = plan({ rows: [{ 編號: "A001", 名稱: "甲" }] })
    const preview = await imports.plan(tenantA, formId, p)

    const tampered = plan({ rows: [{ 編號: "A001", 名稱: "被偷改成別的" }] })
    await expect(
      imports.commit(tenantA, formId, ACTOR, preview.planHash, tampered),
    ).rejects.toThrow()
  })

  it("blockers 非空時 commit 一律拒絕", async () => {
    const formId = await customerForm("blocked", false)
    const p = plan({ rows: [{ 編號: "A001" }] })
    const preview = await imports.plan(tenantA, formId, p)
    await expect(imports.commit(tenantA, formId, ACTOR, preview.planHash, p)).rejects.toThrow()
  })
})

describe("🔴 撤銷:補償批次 + compare-and-set(#106)", () => {
  it("**撤銷新增 → 記錄被軟刪除**", async () => {
    const formId = await customerForm("撤銷新增")
    const p = plan({ rows: [{ 編號: "A001", 名稱: "甲" }] })
    const preview = await imports.plan(tenantA, formId, p)
    const done = await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)

    await imports.revert(tenantA, formId, ACTOR, done.batchId)
    const list = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 10 })
    expect(list.records).toHaveLength(0)
  })

  it("**撤銷更新 → 還原成匯入前的值**(原設計的最大缺口 G1)", async () => {
    const formId = await customerForm("撤銷更新")
    await records.createRecord(tenantA, formId, { 客戶編號: "A001", 客戶名稱: "原本的名字" }, ACTOR)
    const p = plan({ rows: [{ 編號: "A001", 名稱: "匯入改成的名字" }] })
    const preview = await imports.plan(tenantA, formId, p)
    const done = await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)

    const mid = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 10 })
    expect(mid.records[0]?.values.客戶名稱).toBe("匯入改成的名字")

    const result = await imports.revert(tenantA, formId, ACTOR, done.batchId)
    expect(result.reverted).toBe(1)
    const after = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 10 })
    expect(after.records[0]?.values.客戶名稱).toBe("原本的名字")
  })

  it("**匯入後有人改過 → 撤銷跳過該欄並計入衝突** —— 不吃掉他人的編輯(缺口 G3)", async () => {
    const formId = await customerForm("撤銷衝突")
    const created = await records.createRecord(
      tenantA,
      formId,
      { 客戶編號: "A001", 客戶名稱: "原本的" },
      ACTOR,
    )
    const p = plan({ rows: [{ 編號: "A001", 名稱: "匯入寫的" }] })
    const preview = await imports.plan(tenantA, formId, p)
    const done = await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)

    // 匯入之後,有人手動改了同一欄
    const mid = await records.getRecord(tenantA, formId, created.id)
    await records.updateRecord(
      tenantA,
      formId,
      created.id,
      mid.version,
      { 客戶名稱: "同事後來改的" },
      ACTOR,
    )

    const result = await imports.revert(tenantA, formId, ACTOR, done.batchId)
    expect(result.conflicts).toBe(1)
    const after = await records.getRecord(tenantA, formId, created.id)
    expect(after.values.客戶名稱).toBe("同事後來改的")
  })
})

describe("匯入前的破壞性偵測(業界共同破口,#106)", () => {
  it("偵測疑似遺失前導零的識別碼並警告", async () => {
    const formId = await customerForm("前導零")
    const result = await imports.plan(
      tenantA,
      formId,
      plan({ rows: [{ 編號: "A001", 電話: "912345678" }] }),
    )
    expect(result.warnings.map((w) => w.code)).toContain("LEADING_ZERO_LOSS")
  })

  it("偵測科學記號(原始數字已失真)", async () => {
    const formId = await customerForm("科學記號")
    const result = await imports.plan(
      tenantA,
      formId,
      plan({ rows: [{ 編號: "A001", 電話: "2.5E+12" }] }),
    )
    expect(result.warnings.map((w) => w.code)).toContain("SCIENTIFIC_NOTATION")
  })
})
