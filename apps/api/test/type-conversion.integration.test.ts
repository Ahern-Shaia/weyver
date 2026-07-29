import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 #105 型別轉換四態。深研見 field-types-parity.md §0-ter B。 */

const ACTOR = 1
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
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
  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)
}, 120_000)

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

async function formWith(
  name: string,
  type: string,
  values: readonly unknown[],
  options: Record<string, unknown> = {},
): Promise<{ formId: number; fieldId: number }> {
  const { form, fields } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({ name, fields: [{ name: "值", type, options }] }),
    ACTOR,
  )
  const fieldId = fields[0]?.id ?? 0
  for (const v of values) await records.createRecord(tenantA, form.id, { 值: v }, ACTOR)
  return { formId: form.id, fieldId }
}

async function readAll(formId: number): Promise<unknown[]> {
  const list = await records.listRecords(tenantA, formId, { filters: [], sort: [], limit: 50 })
  return list.records.map((r) => r.values.值)
}

describe("🔴 dry-run 必須報兩個數字(#105)", () => {
  it("**清空與改值分開計數** —— Airtable 的真實事故是靜默改值,合併成一個數字會把它藏起來", async () => {
    const { formId, fieldId } = await formWith("兩個數字", "text", ["10", "20.567", "N/A", "壞掉"])
    const preview = await ddl.previewFieldTypeChange(tenantA, formId, fieldId, "number")

    expect(preview.kind).toBe("lossy")
    expect(preview.willBeNulled).toBe(2) // N/A、壞掉
    expect(preview.totalNonNull).toBe(4)
    // 樣本要讓使用者看見「哪些值會不見」,而不是只有一個數字
    expect(preview.samples.sort()).toEqual(["N/A", "壞掉"])
  })

  it("safe-rewrite 無資料會丟:兩個數字皆為 0", async () => {
    const { formId, fieldId } = await formWith("無損", "number", [1, 2, 3])
    const preview = await ddl.previewFieldTypeChange(tenantA, formId, fieldId, "text")
    expect(preview.kind).toBe("safe-rewrite")
    expect(preview.willBeNulled).toBe(0)
  })

  it("forbidden 直接回報,不去掃資料", async () => {
    const { formId, fieldId } = await formWith("禁止", "text", ["x"])
    const preview = await ddl.previewFieldTypeChange(tenantA, formId, fieldId, "attachment")
    expect(preview.kind).toBe("forbidden")
    expect(preview.totalNonNull).toBe(0)
  })

  it("**預覽不得改動任何資料**", async () => {
    const { formId, fieldId } = await formWith("唯讀", "text", ["10", "N/A"])
    await ddl.previewFieldTypeChange(tenantA, formId, fieldId, "number")
    expect((await readAll(formId)).sort()).toEqual(["10", "N/A"])
  })
})

describe("🔴 執行轉換(#105)", () => {
  it("**singleSelect → multiSelect 語意零損失** —— 這是 safe-rewrite 這一態存在的理由", async () => {
    const { formId, fieldId } = await formWith("單轉多", "singleSelect", ["甲", "乙"], {
      choices: ["甲", "乙"],
    })
    const result = await ddl.convertFieldType(tenantA, formId, fieldId, "multiSelect", {})
    expect(result.kind).toBe("safe-rewrite")
    expect((await readAll(formId)).sort()).toEqual([["甲"], ["乙"]].sort())
  })

  it("number → text 無損轉換", async () => {
    const { formId, fieldId } = await formWith("數轉文", "number", [42, 7])
    await ddl.convertFieldType(tenantA, formId, fieldId, "text")
    // numeric(19,4) 直接 ::text 會給 42.0000;trim_scale 去掉小數尾零
    expect((await readAll(formId)).sort()).toEqual(["42", "7"])
  })

  it("**lossy:轉不動的清空,轉得動的保留** —— 不是整批失敗也不是全部清空", async () => {
    const { formId, fieldId } = await formWith("有損", "text", ["10", "N/A", "20"])
    await ddl.convertFieldType(tenantA, formId, fieldId, "number")
    const all = await readAll(formId)
    expect(all.filter((v) => v !== null)).toHaveLength(2)
    expect(all.filter((v) => v === null)).toHaveLength(1)
  })

  it("multiSelect → singleSelect 保留第一個(Baserow 先例)", async () => {
    const { formId, fieldId } = await formWith("多轉單", "multiSelect", [["甲", "乙"]], {
      choices: ["甲", "乙"],
    })
    await ddl.convertFieldType(tenantA, formId, fieldId, "singleSelect")
    expect(await readAll(formId)).toEqual(["甲"])
  })

  it("**checkbox → text 的字面值固定為 true/false**", async () => {
    const { formId, fieldId } = await formWith("勾轉文", "checkbox", [true, false])
    await ddl.convertFieldType(tenantA, formId, fieldId, "text")
    expect((await readAll(formId)).sort()).toEqual(["false", "true"])
  })

  it("forbidden 一律拒絕", async () => {
    const { formId, fieldId } = await formWith("拒絕", "text", ["x"])
    await expect(
      ddl.convertFieldType(tenantA, formId, fieldId, "autoNumber"),
    ).rejects.toThrow()
  })

  it("轉換寫入 ddl_audit(含 kind,供事後追查)", async () => {
    const { formId, fieldId } = await formWith("稽核", "number", [1])
    await ddl.convertFieldType(tenantA, formId, fieldId, "text")
    const { rows } = await pool.query<{ action: string; spec: { kind?: string } }>(
      "SELECT action, spec FROM ddl_audit WHERE form_id = $1 AND action = 'convertFieldType'",
      [formId],
    )
    expect(rows[0]?.spec.kind).toBe("safe-rewrite")
  })
})

describe("轉換後的資料仍可正常讀寫(#105)", () => {
  it("轉成 multiSelect 後可寫入多值", async () => {
    const { formId, fieldId } = await formWith("轉後可寫", "singleSelect", ["甲"], {
      choices: ["甲", "乙"],
    })
    await ddl.convertFieldType(tenantA, formId, fieldId, "multiSelect")
    const created = await records.createRecord(tenantA, formId, { 值: ["甲", "乙"] }, ACTOR)
    expect(created.values.值).toEqual(["甲", "乙"])
  })
})

describe("🔴 lossy 轉換可還原(#105)", () => {
  it("**還原後值回來** —— Ragic 的型別轉換是非破壞性的,客戶心智是「可以隨便試」", async () => {
    const { formId, fieldId } = await formWith("可還原", "text", ["10", "N/A", "20"])
    const done = await ddl.convertFieldType(tenantA, formId, fieldId, "number")
    expect(done.conversionId).toBeDefined()
    // 轉換後:N/A 被清空
    expect((await readAll(formId)).filter((v) => v === null)).toHaveLength(1)

    await ddl.revertFieldConversion(tenantA, formId, fieldId, done.conversionId ?? 0)
    expect((await readAll(formId)).sort()).toEqual(["10", "20", "N/A"])
  })

  it("safe-rewrite 不留快照(無資料會丟,沒有還原的必要)", async () => {
    const { formId, fieldId } = await formWith("無需快照", "number", [1, 2])
    const done = await ddl.convertFieldType(tenantA, formId, fieldId, "text")
    expect(done.conversionId).toBeUndefined()
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM field_conversion_snapshot WHERE form_id = $1",
      [formId],
    )
    expect(rows[0]?.n).toBe(0)
  })

  it("**還原不動轉換後才新增的記錄** —— 它們不在快照裡,不該被牽連", async () => {
    const { formId, fieldId } = await formWith("新增不受影響", "text", ["10", "N/A"])
    const done = await ddl.convertFieldType(tenantA, formId, fieldId, "number")
    const added = await records.createRecord(tenantA, formId, { 值: 999 }, ACTOR)

    await ddl.revertFieldConversion(tenantA, formId, fieldId, done.conversionId ?? 0)
    const after = await records.getRecord(tenantA, formId, added.id)
    expect(after.values.值).toBe("999")
  })

  it("還原後欄位型別也轉回原本的(不只是值)", async () => {
    const { formId, fieldId } = await formWith("型別轉回", "text", ["5"])
    const done = await ddl.convertFieldType(tenantA, formId, fieldId, "number")
    await ddl.revertFieldConversion(tenantA, formId, fieldId, done.conversionId ?? 0)
    // 轉回 text 後,非數字值可以寫入
    const created = await records.createRecord(tenantA, formId, { 值: "純文字" }, ACTOR)
    expect(created.values.值).toBe("純文字")
  })

  it("快照有 30 天到期日(可清理,不無限長)", async () => {
    const { formId, fieldId } = await formWith("到期", "text", ["x"])
    await ddl.convertFieldType(tenantA, formId, fieldId, "number")
    const { rows } = await pool.query<{ days: number }>(
      "SELECT EXTRACT(DAY FROM (expires_at - now()))::int AS days FROM field_conversion_snapshot WHERE form_id = $1 LIMIT 1",
      [formId],
    )
    expect(rows[0]?.days).toBeGreaterThanOrEqual(29)
  })
})
