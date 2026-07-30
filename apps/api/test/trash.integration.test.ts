import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Knex } from "knex"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { TrashPurgeService } from "../src/form-engine/trash/trash-purge.service.js"
import { TrashService } from "../src/form-engine/trash/trash.service.js"

/* 🔴 H-2 回收桶。三個東西在這裡被釘死:
   1. **列表走 app 車道** —— 本 session 已四度踩到「服務/測試用特權連線 → 權限被遮住」。
      回收桶最容易犯這個(「要看到已刪的」很容易變成「繞過限制」)。
   2. **還原前的三類阻擋** —— partial unique 讓同名重建後還原必然 23505,不驗就是丟 500。
   3. **到期真硬刪** —— 在此之前所有刪除都只是 deleted_at,程式註解說的「清理 job」不存在。 */

const ALICE = 501
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let trash: TrashService
let purge: TrashPurgeService
let appKnex: Knex
let ddlKnex: Knex
const destroyers: (() => Promise<void>)[] = []
let tenantA = 0
let tenantB = 0

const configStub = { get: () => undefined } as never

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const metadata = new MetadataService(db, new TenantDb(db))
  ddlKnex = createDdlKnex(container.getConnectionUri())
  destroyers.push(() => ddlKnex.destroy())

  const uri = new URL(container.getConnectionUri())
  uri.username = "app_login"
  uri.password = "app_login"
  appKnex = createDdlKnex(uri.toString())
  destroyers.push(() => appKnex.destroy())

  /* 🔴 TrashService 一律拿 **app 車道** 的 drizzle。用特權連線的話,
     跨租戶洩漏的測試會綠給你看,但線上會漏。 */
  const appPool = new pg.Pool({ connectionString: uri.toString(), max: 5 })
  destroyers.push(() => appPool.end())
  const appDb = createDrizzle(appPool)
  trash = new TrashService(new TenantDb(appDb), db)
  ddl = new DdlService(ddlKnex, db, metadata, undefined, undefined, trash)
  records = new RecordService(appKnex, metadata)
  purge = new TrashPurgeService(ddlKnex, configStub)
}, 180_000)

afterAll(async () => {
  for (const d of destroyers) await d()
  await pool.end()
  await container.stop()
})

async function makeForm(tenantId: number, name: string): Promise<number> {
  const spec = createFormSpecSchema.parse({
    name,
    fields: [{ name: "品名", type: "text" }],
  })
  const { form } = await ddl.createForm(tenantId, spec)
  return form.id
}

describe("H-2 回收桶", () => {
  it("刪記錄 → 回收桶看得到,且與軟刪同一 tx", async () => {
    const formId = await makeForm(tenantA, "刪記錄測試")
    const rec = await records.createRecord(tenantA, formId, { 品名: "醬油" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)

    const items = await trash.list(tenantA)
    const hit = items.find((i) => i.resourceType === "record" && i.resourceId === rec.id)
    expect(hit).toBeDefined()
    expect(hit?.formId).toBe(formId)
    // 30 天保留期(OQ-RB-1)
    const days = ((hit?.purgeAfter.getTime() ?? 0) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThan(31)
  })

  it("🔴 兩張不同表的 record 1 各自入桶(記錄 id 是每表獨立的 identity)", async () => {
    /* 瀏覽器實走抓到的 bug:唯一索引漏了 form_id → 第二張表刪它的 record 1 時撞第一張表那筆,
       而插入走 ON CONFLICT DO NOTHING,entry 被**靜默吞掉** —— 記錄刪了但回收桶裡沒有。
       整合測原本抓不到,因為每個案例都用剛建的表 + 遞增 id,從不跨表撞號。 */
    const formX = await makeForm(tenantA, "撞號X")
    const formY = await makeForm(tenantA, "撞號Y")
    const recX = await records.createRecord(tenantA, formX, { 品名: "X的第一筆" }, ALICE)
    const recY = await records.createRecord(tenantA, formY, { 品名: "Y的第一筆" }, ALICE)
    expect(recX.id).toBe(recY.id) // 兩張表各自從 1 開始 —— 這就是撞號的來源

    await records.softDeleteRecord(tenantA, formX, recX.id, ALICE)
    await records.softDeleteRecord(tenantA, formY, recY.id, ALICE)

    const items = await trash.list(tenantA)
    expect(items.some((i) => i.formId === formX && i.resourceId === recX.id)).toBe(true)
    expect(items.some((i) => i.formId === formY && i.resourceId === recY.id)).toBe(true)
  })

  it("記錄的回收桶項目帶表單名快照(表單被刪後仍看得出原屬何處)", async () => {
    const formId = await makeForm(tenantA, "快照表單名")
    const rec = await records.createRecord(tenantA, formId, { 品名: "罐頭" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)
    await ddl.dropForm(tenantA, formId, ALICE)

    const hit = (await trash.list(tenantA)).find(
      (i) => i.resourceType === "record" && i.formId === formId,
    )
    expect(hit?.formName).toBe("快照表單名")
    expect(hit?.title).toBe("罐頭") // 標題也是快照,不是 #id
  })

  it("🔴 B 租戶看不到 A 刪的東西(RLS,非應用層過濾)", async () => {
    const formId = await makeForm(tenantA, "隔離測試")
    const rec = await records.createRecord(tenantA, formId, { 品名: "米" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)

    const seenByB = await trash.list(tenantB)
    expect(seenByB.some((i) => i.resourceId === rec.id && i.resourceType === "record")).toBe(false)
  })

  it("記錄還原:資料回來,entry 結案", async () => {
    const formId = await makeForm(tenantA, "還原記錄")
    const rec = await records.createRecord(tenantA, formId, { 品名: "鹽" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)

    const done = await records.restoreRecord(tenantA, formId, rec.id, ALICE)
    expect(done.ok).toBe(true)
    const back = await records.getRecord(tenantA, formId, rec.id)
    expect(back.values.品名).toBe("鹽")
    expect((await trash.list(tenantA)).some((i) => i.resourceId === rec.id)).toBe(false)
  })

  it("🔴 還原記錄會違反「後加的 unique」→ 擋下並說明是哪個欄位", async () => {
    const formId = await makeForm(tenantA, "後加約束")
    const rec = await records.createRecord(tenantA, formId, { 品名: "糖" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)
    // 刪除之後才有人用同一個值再建一筆,並把該欄設為唯一
    await records.createRecord(tenantA, formId, { 品名: "糖" }, ALICE)
    await ddlKnex("field_def").where({ form_id: formId, name: "品名" }).update({ is_unique: true })

    const violations = await records.probeRestoreConflicts(tenantA, formId, rec.id)
    expect(violations.some((v) => v.includes("品名"))).toBe(true)
    const attempt = await records.restoreRecord(tenantA, formId, rec.id, ALICE)
    expect(attempt.ok).toBe(false)
    // 擋下就是擋下 —— 資料不得被半還原
    const still = await appKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .first<{ deleted_at: Date | null } | undefined>("deleted_at")
    expect(still?.deleted_at).not.toBeNull()
    await ddlKnex("field_def").where({ form_id: formId, name: "品名" }).update({ is_unique: false })
  })

  it("🔴 表單還原只帶回「當初連帶刪的」欄位,先前個別刪掉的不復活", async () => {
    const formId = await makeForm(tenantA, "連帶還原")
    const extra = await ddl.addField(tenantA, formId, { name: "備註", type: "text", required: false, unique: false, options: {} })
    // 先個別刪「備註」,之後才刪整張表
    await ddl.dropField(tenantA, formId, extra.id, ALICE)
    await ddl.dropForm(tenantA, formId, ALICE)

    const entry = (await trash.list(tenantA)).find(
      (i) => i.resourceType === "form" && i.resourceId === formId,
    )
    expect(entry).toBeDefined()
    const restored = await trash.restore(tenantA, entry?.id ?? 0)
    expect(restored.ok).toBe(true)

    const fields = await ddlKnex("field_def").where({ form_id: formId }).select("name", "deleted_at")
    const alive = fields.filter((f) => f.deleted_at === null).map((f) => f.name)
    expect(alive).toContain("品名")
    expect(alive).not.toContain("備註") // 刪表之前就刪了,不該一起回來
  })

  it("🔴 同名重建後還原 → 明確阻擋(partial unique 否則必噴 23505)", async () => {
    const first = await makeForm(tenantA, "重複名稱")
    await ddl.dropForm(tenantA, first, ALICE)
    await makeForm(tenantA, "重複名稱") // 同名重建

    const entry = (await trash.list(tenantA)).find(
      (i) => i.resourceType === "form" && i.resourceId === first,
    )
    const plan = await trash.planRestore(tenantA, entry?.id ?? 0)
    expect(plan?.blockers.some((b) => b.kind === "nameConflict")).toBe(true)
    const attempt = await trash.restore(tenantA, entry?.id ?? 0)
    expect(attempt.ok).toBe(false)
  })

  it("🔴 父表單已刪 → 拒絕單獨還原欄位,並要求先還原表單", async () => {
    const formId = await makeForm(tenantA, "父子順序")
    const extra = await ddl.addField(tenantA, formId, { name: "數量", type: "number", required: false, unique: false, options: {} })
    await ddl.dropField(tenantA, formId, extra.id, ALICE)
    await ddl.dropForm(tenantA, formId, ALICE)

    const entry = (await trash.list(tenantA)).find(
      (i) => i.resourceType === "field" && i.resourceId === extra.id,
    )
    const plan = await trash.planRestore(tenantA, entry?.id ?? 0)
    expect(plan?.blockers.some((b) => b.kind === "parentDeleted")).toBe(true)
  })
})

describe("H-2 保留期硬刪", () => {
  it("🔴 逾期記錄真的被 DELETE(不是再標一次 deleted_at)", async () => {
    const formId = await makeForm(tenantA, "逾期記錄")
    const rec = await records.createRecord(tenantA, formId, { 品名: "過期品" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)
    await ddlKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .update({ deleted_at: ddlKnex.raw("now() - interval '40 days'") })

    expect(await purge.purgeRecords()).toBeGreaterThan(0)
    const gone = await ddlKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .first()
    expect(gone).toBeUndefined()
  })

  it("🔴 簽核中的記錄即使逾期也不硬刪(傳票不可變)", async () => {
    const formId = await makeForm(tenantA, "簽核保護")
    const rec = await records.createRecord(tenantA, formId, { 品名: "已核准單" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)
    await ddlKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .update({ deleted_at: ddlKnex.raw("now() - interval '90 days'") })
    await ddlKnex("approval_instance").insert({
      tenant_id: tenantA,
      def_id: 1,
      form_id: formId,
      record_id: rec.id,
      status: "approved",
      submitted_by: ALICE,
    })

    await purge.purgeRecords()
    const survived = await ddlKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .first()
    expect(survived).toBeDefined()
  })

  it("🔴 逾期欄位真的 DROP COLUMN(物理欄至此才回收)", async () => {
    const formId = await makeForm(tenantA, "逾期欄位")
    const extra = await ddl.addField(tenantA, formId, { name: "待清欄", type: "text", required: false, unique: false, options: {} })
    await ddl.dropField(tenantA, formId, extra.id, ALICE)
    await ddlKnex("field_def")
      .where({ id: extra.id })
      .update({ deleted_at: ddlKnex.raw("now() - interval '40 days'") })

    expect(await purge.purgeFields()).toBeGreaterThan(0)
    const cols = await ddlKnex.raw<{ rows: { column_name: string }[] }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='data' AND table_name=?",
      [`t${String(formId)}`],
    )
    expect(cols.rows.map((c) => c.column_name)).not.toContain(`f${String(extra.id)}`)
    expect(await ddlKnex("field_def").where({ id: extra.id }).first()).toBeUndefined()
  })

  it("🔴 逾期表單真的 DROP TABLE", async () => {
    const formId = await makeForm(tenantA, "逾期表單")
    await ddl.dropForm(tenantA, formId, ALICE)
    await ddlKnex("form_def")
      .where({ id: formId })
      .update({ deleted_at: ddlKnex.raw("now() - interval '40 days'") })

    expect(await purge.purgeForms()).toBeGreaterThan(0)
    const exists = await ddlKnex.raw<{ rows: { ok: boolean }[] }>(
      "SELECT to_regclass(?) IS NOT NULL AS ok",
      [`data.t${String(formId)}`],
    )
    expect(exists.rows[0]?.ok).toBe(false)
  })

  it("沒有 trash_entry 的舊軟刪資料一樣會被清(合規不能有死角)", async () => {
    const formId = await makeForm(tenantA, "無 entry 舊資料")
    const rec = await records.createRecord(tenantA, formId, { 品名: "孤兒" }, ALICE)
    // 模擬 H-2 之前的軟刪:直接改 deleted_at,不寫任何 entry
    await ddlKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .update({ deleted_at: ddlKnex.raw("now() - interval '40 days'") })
    expect(
      await ddlKnex("trash_entry").where({ form_id: formId, resource_id: rec.id }).first(),
    ).toBeUndefined()

    await purge.purgeRecords()
    const gone = await ddlKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .first()
    expect(gone).toBeUndefined()
  })

  it("🔴 父表單已在回收桶時,記錄仍可永久刪除", async () => {
    /* 瀏覽器實走抓到:hardDeleteRecord 原本走 resolveForm,而表單已軟刪 →
       丟 FormNotFoundError,使用者看到誤導的 404「form 733 not found」。
       「父表單也被刪了」正是硬刪記錄最常見的情境。 */
    const formId = await makeForm(tenantA, "父已入桶")
    const rec = await records.createRecord(tenantA, formId, { 品名: "孤兒記錄" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)
    await ddl.dropForm(tenantA, formId, ALICE)

    await expect(records.hardDeleteRecord(tenantA, formId, rec.id)).resolves.toBeUndefined()
    const gone = await ddlKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .first()
    expect(gone).toBeUndefined()
  })

  it("🔴 簽核中的記錄連立即硬刪也擋(不只排程 purge)", async () => {
    const formId = await makeForm(tenantA, "立即硬刪保護")
    const rec = await records.createRecord(tenantA, formId, { 品名: "已核准" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)
    await ddlKnex("approval_instance").insert({
      tenant_id: tenantA,
      def_id: 1,
      form_id: formId,
      record_id: rec.id,
      status: "approved",
      submitted_by: ALICE,
    })
    await expect(records.hardDeleteRecord(tenantA, formId, rec.id)).rejects.toThrow()
  })

  it("未逾期的不動", async () => {
    const formId = await makeForm(tenantA, "還在保留期")
    const rec = await records.createRecord(tenantA, formId, { 品名: "剛刪的" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)

    await purge.purgeRecords()
    const still = await ddlKnex
      .withSchema("data")
      .table(`t${String(formId)}`)
      .where({ id: rec.id })
      .first()
    expect(still).toBeDefined()
  })
})
