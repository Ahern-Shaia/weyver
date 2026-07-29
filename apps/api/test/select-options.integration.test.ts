import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { OptionService } from "../src/form-engine/field-types/option.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 追溯稽核 #105|選項改名原本完全不動資料 → 既有記錄留舊字串變孤兒。
   深研見 field-types-parity.md §0-ter C。 */

const ACTOR = 1
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let options: OptionService
let metadata: MetadataService
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
  metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)
  options = new OptionService(ddlKnex, metadata)
}, 120_000)

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

const C = (id: string, name: string): { id: string; name: string } => ({ id, name })

async function selectForm(
  name: string,
  type: "singleSelect" | "multiSelect",
  choices: readonly { id: string; name: string }[],
): Promise<{ formId: number; fieldId: number }> {
  const { form, fields } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name,
      fields: [
        { name: "編號", type: "text" },
        { name: "狀態", type, options: { choices } },
      ],
    }),
    ACTOR,
  )
  const field = fields.find((f) => f.name === "狀態")
  return { formId: form.id, fieldId: field?.id ?? 0 }
}

async function readStatus(formId: number, recordId: number): Promise<unknown> {
  const row = await records.getRecord(tenantA, formId, recordId)
  return row.values.狀態
}

describe("🔴 選項改名連動既有記錄(追溯稽核 #105)", () => {
  it("**單選改名後既有記錄跟著改** —— 原本只改 metadata,記錄留舊字串變孤兒", async () => {
    const { formId, fieldId } = await selectForm("簽核單", "singleSelect", [
      C("o00000001", "已核准"),
      C("o00000002", "待審"),
    ])
    const r1 = await records.createRecord(tenantA, formId, { 編號: "A", 狀態: "已核准" }, ACTOR)
    await records.createRecord(tenantA, formId, { 編號: "B", 狀態: "待審" }, ACTOR)

    const result = await options.updateOptions(tenantA, formId, fieldId, [
      C("o00000001", "核准通過"),
      C("o00000002", "待審"),
    ])
    expect(result.renamed).toBe(1)
    expect(result.affectedRows).toBe(1)
    expect(await readStatus(formId, r1.id)).toBe("核准通過")

    // 改名後仍可用新名寫入(valueSchema 走的是新 options)
    const r3 = await records.createRecord(tenantA, formId, { 編號: "C", 狀態: "核准通過" }, ACTOR)
    expect(await readStatus(formId, r3.id)).toBe("核准通過")
  })

  it("**交換改名 A↔B 不得毀資料** —— 逐條依序 UPDATE 會把兩者都變成同一個值", async () => {
    const { formId, fieldId } = await selectForm("交換測試", "singleSelect", [
      C("o00000001", "甲"),
      C("o00000002", "乙"),
    ])
    const ra = await records.createRecord(tenantA, formId, { 編號: "A", 狀態: "甲" }, ACTOR)
    const rb = await records.createRecord(tenantA, formId, { 編號: "B", 狀態: "乙" }, ACTOR)

    await options.updateOptions(tenantA, formId, fieldId, [
      C("o00000001", "乙"),
      C("o00000002", "甲"),
    ])

    expect(await readStatus(formId, ra.id)).toBe("乙")
    expect(await readStatus(formId, rb.id)).toBe("甲")
  })

  it("三值循環改名 A→B→C→A 亦正確", async () => {
    const { formId, fieldId } = await selectForm("循環測試", "singleSelect", [
      C("o00000001", "紅"),
      C("o00000002", "綠"),
      C("o00000003", "藍"),
    ])
    const r = await Promise.all(
      ["紅", "綠", "藍"].map((v, i) =>
        records.createRecord(tenantA, formId, { 編號: String(i), 狀態: v }, ACTOR),
      ),
    )

    await options.updateOptions(tenantA, formId, fieldId, [
      C("o00000001", "綠"),
      C("o00000002", "藍"),
      C("o00000003", "紅"),
    ])

    expect(await readStatus(formId, r[0]?.id ?? 0)).toBe("綠")
    expect(await readStatus(formId, r[1]?.id ?? 0)).toBe("藍")
    expect(await readStatus(formId, r[2]?.id ?? 0)).toBe("紅")
  })

  it("多選改名連動,且**保留陣列順序**", async () => {
    const { formId, fieldId } = await selectForm("多選測試", "multiSelect", [
      C("o00000001", "過敏原"),
      C("o00000002", "冷藏"),
      C("o00000003", "素食"),
    ])
    const r = await records.createRecord(
      tenantA,
      formId,
      { 編號: "A", 狀態: ["過敏原", "冷藏", "素食"] },
      ACTOR,
    )

    await options.updateOptions(tenantA, formId, fieldId, [
      C("o00000001", "含過敏原"),
      C("o00000002", "冷藏"),
      C("o00000003", "素食"),
    ])
    expect(await readStatus(formId, r.id)).toEqual(["含過敏原", "冷藏", "素食"])
  })

  it("改名撞到未改名的既有選項 → 拒絕(合併須明示,不默默合併)", async () => {
    const { formId, fieldId } = await selectForm("撞名測試", "singleSelect", [
      C("o00000001", "甲"),
      C("o00000002", "乙"),
    ])
    await expect(
      options.updateOptions(tenantA, formId, fieldId, [
        C("o00000001", "乙"),
        C("o00000002", "乙"),
      ]),
    ).rejects.toThrow()
  })
})

describe("🔴 選項刪除:軟停用而非清空資料(追溯稽核 #105)", () => {
  it("**移除仍被使用的選項 → 預設停用,既有值保留** —— Airtable 是直接清空且無警告", async () => {
    const { formId, fieldId } = await selectForm("停用測試", "singleSelect", [
      C("o00000001", "舊分類"),
      C("o00000002", "新分類"),
    ])
    const r = await records.createRecord(tenantA, formId, { 編號: "A", 狀態: "舊分類" }, ACTOR)

    await options.updateOptions(tenantA, formId, fieldId, [C("o00000002", "新分類")])

    // 值還在
    expect(await readStatus(formId, r.id)).toBe("舊分類")
    // 選項被保留但標記停用
    const form = await metadata.getForm(tenantA, formId)
    const choices = (form.fields.find((f) => f.id === fieldId)?.options as {
      choices: { id: string; name: string; retired?: boolean }[]
    }).choices
    expect(choices.find((c) => c.id === "o00000001")?.retired).toBe(true)
    // 持有停用值的記錄仍可存檔(否則使用者會覺得系統壞了)
    await records.updateRecord(tenantA, formId, r.id, 1, { 編號: "A2", 狀態: "舊分類" }, ACTOR)
  })

  it("沒被使用的選項可直接移除(不留停用垃圾)", async () => {
    const { formId, fieldId } = await selectForm("硬刪測試", "singleSelect", [
      C("o00000001", "沒人用"),
      C("o00000002", "有人用"),
    ])
    await records.createRecord(tenantA, formId, { 編號: "A", 狀態: "有人用" }, ACTOR)

    await options.updateOptions(tenantA, formId, fieldId, [C("o00000002", "有人用")])
    const form = await metadata.getForm(tenantA, formId)
    const choices = (form.fields.find((f) => f.id === fieldId)?.options as {
      choices: { id: string }[]
    }).choices
    expect(choices.map((c) => c.id)).toEqual(["o00000002"])
  })

  it("deleteMode=replace 把既有值改成指定選項", async () => {
    const { formId, fieldId } = await selectForm("取代測試", "singleSelect", [
      C("o00000001", "暫定"),
      C("o00000002", "確認"),
    ])
    const r = await records.createRecord(tenantA, formId, { 編號: "A", 狀態: "暫定" }, ACTOR)

    await options.updateOptions(tenantA, formId, fieldId, [C("o00000002", "確認")], "replace", "確認")
    expect(await readStatus(formId, r.id)).toBe("確認")
  })

  it("deleteMode=clear 才清空;多選只移除該元素", async () => {
    const { formId, fieldId } = await selectForm("清空測試", "multiSelect", [
      C("o00000001", "作廢"),
      C("o00000002", "保留"),
    ])
    const r = await records.createRecord(
      tenantA,
      formId,
      { 編號: "A", 狀態: ["作廢", "保留"] },
      ACTOR,
    )

    await options.updateOptions(tenantA, formId, fieldId, [C("o00000002", "保留")], "clear")
    expect(await readStatus(formId, r.id)).toEqual(["保留"])
  })
})

describe("刪除前的使用量(業界無一家提供)", () => {
  it("usageCounts 回報每個選項被幾筆記錄使用", async () => {
    const { formId, fieldId } = await selectForm("使用量", "singleSelect", [
      C("o00000001", "甲"),
      C("o00000002", "乙"),
      C("o00000003", "丙"),
    ])
    await records.createRecord(tenantA, formId, { 編號: "1", 狀態: "甲" }, ACTOR)
    await records.createRecord(tenantA, formId, { 編號: "2", 狀態: "甲" }, ACTOR)
    await records.createRecord(tenantA, formId, { 編號: "3", 狀態: "乙" }, ACTOR)

    /* 以 option id 為 key —— 名稱會變,id 不會(改名後 UI 才查得到筆數) */
    expect(await options.usageCounts(tenantA, formId, fieldId)).toEqual({
      o00000001: 2,
      o00000002: 1,
      o00000003: 0,
    })
  })

  it("多選的使用量按元素計", async () => {
    const { formId, fieldId } = await selectForm("多選使用量", "multiSelect", [
      C("o00000001", "冷藏"),
      C("o00000002", "冷凍"),
    ])
    await records.createRecord(tenantA, formId, { 編號: "1", 狀態: ["冷藏", "冷凍"] }, ACTOR)
    await records.createRecord(tenantA, formId, { 編號: "2", 狀態: ["冷藏"] }, ACTOR)

    expect(await options.usageCounts(tenantA, formId, fieldId)).toEqual({
      o00000001: 2,
      o00000002: 1,
    })
  })
})

describe("選項名稱唯一性", () => {
  it("case-insensitive 重複名稱被拒(對齊 Notion)", async () => {
    await expect(
      selectForm("重複名", "singleSelect", [C("o00000001", "Apple"), C("o00000002", "apple")]),
    ).rejects.toThrow()
  })
})

describe("不得繞道 /type 改選項", () => {
  it("**alterFieldType 對同型別 select 直接拒絕** —— 那條路只換 metadata 不動資料", async () => {
    const { formId, fieldId } = await selectForm("繞道測試", "singleSelect", [
      C("o00000001", "甲"),
      C("o00000002", "乙"),
    ])
    const r = await records.createRecord(tenantA, formId, { 編號: "A", 狀態: "甲" }, ACTOR)

    await expect(
      ddl.alterFieldType(tenantA, formId, fieldId, "singleSelect", {
        choices: [C("o00000001", "改過的甲"), C("o00000002", "乙")],
      }),
    ).rejects.toThrow()

    // 值沒被動過,也沒變成孤兒
    expect(await readStatus(formId, r.id)).toBe("甲")
  })
})

describe("🔴 使用量以 option id 為 key(瀏覽器實走時發現)", () => {
  it("**改名後仍查得到筆數** —— 以名稱為 key 會讓「N 筆使用中」的保護靜默消失", async () => {
    const { formId, fieldId } = await selectForm("改名後使用量", "singleSelect", [
      C("o00000001", "已核准"),
      C("o00000002", "待審"),
    ])
    await records.createRecord(tenantA, formId, { 編號: "A", 狀態: "已核准" }, ACTOR)

    await options.updateOptions(tenantA, formId, fieldId, [
      C("o00000001", "核准通過"),
      C("o00000002", "待審"),
    ])

    const usage = await options.usageCounts(tenantA, formId, fieldId)
    expect(usage.o00000001).toBe(1)
  })
})
