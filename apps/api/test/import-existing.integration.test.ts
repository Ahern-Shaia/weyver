import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { OptionService } from "../src/form-engine/field-types/option.service.js"
import { importPlanSchema } from "../src/form-engine/import/import-specs.js"
import { ImportService } from "../src/form-engine/import/import.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

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
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
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
  imports = new ImportService(tenantDb, metadata, records, new OptionService(ddlKnex, metadata), db)
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

    // clear 需打字確認表單名稱(OQ-IMP-2)
    await imports.commit(tenantA, formId, ACTOR, preview.planHash, p, "空白清空")
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

describe("🔴 匯入不得繞過簽核鎖(#106)", () => {
  it("**簽核中的記錄不得被匯入改掉** —— 匯入端點不經 ApprovalLockInterceptor", async () => {
    const formId = await customerForm("簽核鎖")
    const rec = await records.createRecord(
      tenantA,
      formId,
      { 客戶編號: "A001", 客戶名稱: "原本的" },
      ACTOR,
    )
    // 直接造一筆進行中的簽核(不經 service,只驗鎖是否被尊重)
    await pool.query(
      `INSERT INTO approval_instance (tenant_id, form_id, record_id, def_id, status, current_step, submitted_by)
       VALUES ($1, $2, $3, 1, 'pending', 1, $4)`,
      [tenantA, formId, rec.id, ACTOR],
    )

    const p = plan({ rows: [{ 編號: "A001", 名稱: "偷改的" }] })
    const preview = await imports.plan(tenantA, formId, p)
    expect(preview.totals.skipped).toBe(1)
    expect(preview.warnings.map((w) => w.code)).toContain("RECORD_LOCKED")

    await imports.commit(tenantA, formId, ACTOR, preview.planHash, p)
    const after = await records.getRecord(tenantA, formId, rec.id)
    expect(after.values.客戶名稱).toBe("原本的")
  })
})

/* 🔴 未知選項(#106):schema 一直接受 `create`,但實作只有 error 路徑 ——
   使用者選了「自動新增選項」,結果整批在寫入時失敗。 */
describe("未知選項處理", () => {
  async function selectForm(name: string): Promise<number> {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name,
        fields: [
          { name: "編號", type: "text", unique: true },
          { name: "狀態", type: "singleSelect", options: { choices: ["已完成", "處理中"] } },
        ],
      }),
      ACTOR,
    )
    return form.id
  }

  const selectPlan = (over: Record<string, unknown>) =>
    importPlanSchema.parse({
      policy: "upsert",
      matchFields: ["編號"],
      mapping: { no: "編號", st: "狀態" },
      rows: [],
      ...over,
    })

  it("**error 模式:在 plan 階段就擋下並列出是哪些值**(不是按了匯入才整批失敗)", async () => {
    const formId = await selectForm(`未知選項擋_${String(Date.now()).slice(-6)}`)
    const result = await imports.plan(
      tenantA,
      formId,
      selectPlan({ rows: [{ no: "A1", st: "已取消" }] }),
    )
    const blocker = result.blockers.find((b) => b.code === "UNKNOWN_OPTION")
    expect(blocker).toBeDefined()
    expect(blocker?.message).toContain("已取消")
  })

  it("create 模式:plan 警告會新增哪些,commit 真的把選項加進去", async () => {
    const formId = await selectForm(`未知選項建_${String(Date.now()).slice(-6)}`)
    const input = selectPlan({
      unknownSelectOption: "create",
      rows: [
        { no: "A1", st: "已取消" },
        { no: "A2", st: "已完成" },
      ],
    })
    const planned = await imports.plan(tenantA, formId, input)
    expect(planned.blockers).toHaveLength(0)
    expect(planned.warnings.map((w) => w.code)).toContain("OPTION_WILL_BE_CREATED")

    const committed = await imports.commit(tenantA, formId, ACTOR, planned.planHash, input)
    expect(committed.inserted).toBe(2)

    const rows = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 10 })
    expect(rows.records.map((r) => r.values.狀態).sort()).toEqual(["已取消", "已完成"])
  })
})

describe("匯入批次清單(撤銷 UI 的前提)", () => {
  it("列出本表批次,且已被撤銷者標出 revertedByBatchId", async () => {
    const formId = await customerForm(`批次清單_${String(Date.now()).slice(-6)}`)
    const input = plan({
      policy: "insert_only",
      matchFields: [],
      rows: [{ 編號: "B1", 名稱: "甲" }],
    })
    const planned = await imports.plan(tenantA, formId, input)
    const committed = await imports.commit(tenantA, formId, ACTOR, planned.planHash, input)

    let batches = await imports.listBatches(tenantA, formId)
    expect(batches[0]?.id).toBe(committed.batchId)
    expect(batches[0]?.revertedByBatchId).toBeNull()

    await imports.revert(tenantA, formId, ACTOR, committed.batchId)
    batches = await imports.listBatches(tenantA, formId)
    const original = batches.find((b) => b.id === committed.batchId)
    // 撤銷本身也是一筆批次(補償而非刪歷史),原批次標記為已被撤銷
    expect(original?.revertedByBatchId).not.toBeNull()
    expect(batches.some((b) => b.kind === "revert")).toBe(true)
  })
})

/* 🔴 §4.2 決策表未落地的三格(全採建議 2026-07-29)。 */
describe("決策表補完:命中多筆 / 正規化命中 / 大量影響", () => {
  it("**既有命中多筆 → 擋**(Airtable 擴充在此是全部更新且不警告,文件明寫絕不採)", async () => {
    const formId = await customerForm(`命中多筆_${String(Date.now()).slice(-6)}`)
    /* unique 擋不住這件事:欄位層 unique 看原值,比對用的是正規化後的值 ——
       「A001」與「a001」在 DB 是兩筆合法記錄,正規化後卻是同一個 key。 */
    await records.createRecord(tenantA, formId, { 客戶編號: "A001", 客戶名稱: "甲" }, ACTOR)
    await records.createRecord(tenantA, formId, { 客戶編號: "a001", 客戶名稱: "乙" }, ACTOR)

    const result = await imports.plan(
      tenantA,
      formId,
      plan({ rows: [{ 編號: "A001", 名稱: "更新" }] }),
    )
    expect(result.blockers.map((b) => b.code)).toContain("MULTIPLE_MATCH")
  })

  it("表上別處的重複不擋這份檔案(只擋檔案真的會碰到的 key)", async () => {
    const formId = await customerForm(`無關重複_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 客戶編號: "X1", 客戶名稱: "甲" }, ACTOR)
    await records.createRecord(tenantA, formId, { 客戶編號: "x1", 客戶名稱: "乙" }, ACTOR)

    const result = await imports.plan(
      tenantA,
      formId,
      plan({ rows: [{ 編號: "Z9", 名稱: "無關" }] }),
    )
    expect(result.blockers.map((b) => b.code)).not.toContain("MULTIPLE_MATCH")
  })

  it("正規化之後才命中 → 警告(使用者有權知道兩個看起來不同的值被當成同一筆)", async () => {
    const formId = await customerForm(`正規化命中_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 客戶編號: "B001", 客戶名稱: "原" }, ACTOR)

    const result = await imports.plan(
      tenantA,
      formId,
      plan({ rows: [{ 編號: " b001 ", 名稱: "新" }] }),
    )
    expect(result.warnings.map((w) => w.code)).toContain("NORMALIZED_MATCH")
    expect(result.totals.toUpdate).toBe(1)
  })

  it("原值就一模一樣時不發正規化警告(不誤報)", async () => {
    const formId = await customerForm(`原值相同_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 客戶編號: "C001", 客戶名稱: "原" }, ACTOR)

    const result = await imports.plan(
      tenantA,
      formId,
      plan({ rows: [{ 編號: "C001", 名稱: "新" }] }),
    )
    expect(result.warnings.map((w) => w.code)).not.toContain("NORMALIZED_MATCH")
  })

  it("更新比例過高 → 警告 + needsConfirm(小表被大改)", async () => {
    const formId = await customerForm(`大量影響_${String(Date.now()).slice(-6)}`)
    for (const n of ["D1", "D2", "D3"]) {
      await records.createRecord(tenantA, formId, { 客戶編號: n, 客戶名稱: "原" }, ACTOR)
    }
    const result = await imports.plan(
      tenantA,
      formId,
      plan({
        rows: [
          { 編號: "D1", 名稱: "改" },
          { 編號: "D2", 名稱: "改" },
        ],
      }),
    )
    expect(result.impact.needsConfirm).toBe(true)
    expect(result.impact.existingTotal).toBe(3)
    expect(result.warnings.map((w) => w.code)).toContain("LARGE_IMPACT")
  })

  it("小幅更新不觸發二次確認", async () => {
    const formId = await customerForm(`小幅更新_${String(Date.now()).slice(-6)}`)
    for (let i = 0; i < 10; i++) {
      await records.createRecord(
        tenantA,
        formId,
        { 客戶編號: `E${String(i)}`, 客戶名稱: "原" },
        ACTOR,
      )
    }
    const result = await imports.plan(tenantA, formId, plan({ rows: [{ 編號: "E0", 名稱: "改" }] }))
    expect(result.impact.needsConfirm).toBe(false)
  })
})

/* 🔴 OQ-IMP-2(決策方直接裁定,涉資料銷毀):清空既有值需打字確認表單名稱。
 **後端也驗** —— 只放前端對話框等於沒有,直接打 API 就繞過了。 */
describe("清空既有值需確認表單名稱", () => {
  it("blankPolicy=clear 未帶確認 → 擋", async () => {
    const name = `清空確認_${String(Date.now()).slice(-6)}`
    const formId = await customerForm(name)
    await records.createRecord(
      tenantA,
      formId,
      { 客戶編號: "F1", 客戶名稱: "原", 電話: "0912" },
      ACTOR,
    )
    const input = plan({ blankPolicy: "clear", rows: [{ 編號: "F1", 名稱: "新", 電話: "" }] })
    const planned = await imports.plan(tenantA, formId, input)
    await expect(imports.commit(tenantA, formId, ACTOR, planned.planHash, input)).rejects.toThrow(
      /表單名稱/,
    )
  })

  it("帶對表單名稱 → 放行,且空白格真的清空", async () => {
    const name = `清空放行_${String(Date.now()).slice(-6)}`
    const formId = await customerForm(name)
    await records.createRecord(
      tenantA,
      formId,
      { 客戶編號: "G1", 客戶名稱: "原", 電話: "0912" },
      ACTOR,
    )
    const input = plan({ blankPolicy: "clear", rows: [{ 編號: "G1", 名稱: "新", 電話: "" }] })
    const planned = await imports.plan(tenantA, formId, input)
    await imports.commit(tenantA, formId, ACTOR, planned.planHash, input, name)

    const rows = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 10 })
    expect(rows.records[0]?.values.電話).toBeNull()
  })

  it("預設 keep 不需確認(既有行為不受影響)", async () => {
    const formId = await customerForm(`預設保留_${String(Date.now()).slice(-6)}`)
    const input = plan({
      policy: "insert_only",
      matchFields: [],
      rows: [{ 編號: "H1", 名稱: "甲" }],
    })
    const planned = await imports.plan(tenantA, formId, input)
    await expect(
      imports.commit(tenantA, formId, ACTOR, planned.planHash, input),
    ).resolves.toBeDefined()
  })
})

describe("撤銷保留期(OQ-IMP-1 = 30 天)", () => {
  it("逾期批次不給撤銷(diff 還在,但久遠的還原會吃掉他人後續編輯)", async () => {
    const formId = await customerForm(`保留期_${String(Date.now()).slice(-6)}`)
    const input = plan({
      policy: "insert_only",
      matchFields: [],
      rows: [{ 編號: "I1", 名稱: "甲" }],
    })
    const planned = await imports.plan(tenantA, formId, input)
    const committed = await imports.commit(tenantA, formId, ACTOR, planned.planHash, input)

    await pool.query(
      `UPDATE import_batch SET revert_expires_at = now() - interval '1 day' WHERE id = $1`,
      [committed.batchId],
    )
    await expect(imports.revert(tenantA, formId, ACTOR, committed.batchId)).rejects.toThrow(/30 天/)
  })

  it("期限內可撤銷", async () => {
    const formId = await customerForm(`期限內_${String(Date.now()).slice(-6)}`)
    const input = plan({
      policy: "insert_only",
      matchFields: [],
      rows: [{ 編號: "J1", 名稱: "甲" }],
    })
    const planned = await imports.plan(tenantA, formId, input)
    const committed = await imports.commit(tenantA, formId, ACTOR, planned.planHash, input)
    await expect(imports.revert(tenantA, formId, ACTOR, committed.batchId)).resolves.toBeDefined()
  })
})
