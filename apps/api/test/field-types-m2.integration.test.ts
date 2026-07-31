import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* R1·UP-4 M2 autoNumber pattern(counter table)+ 選項顏色/連動 + link displayFields options。 */

const ACTOR = 1
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let metadata: MetadataService
let records: RecordService
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
  metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)
})

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

describe("R1·UP-4 M2 autoNumber pattern + 選項擴充", () => {
  it("dateFormat + monthly reset → prefix+yyyyMM+seq 遞增(counter)", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "月結單",
        fields: [
          {
            name: "單號",
            type: "autoNumber",
            options: { prefix: "PO", width: 4, dateFormat: "yyyyMM", resetScope: "monthly" },
          },
          { name: "備註", type: "text" },
        ],
      }),
    )
    /* 🔴 期望值必須用**租戶時區**算,不能用 UTC。

       autoNumber 的日期段以 `tenants.timezone`(預設 Asia/Taipei)判定 ——
       那正是它存在的理由:台灣 UTC+8 若走 UTC,01/01 08:00 前開的單會拿到
       去年的年度序號,而那是已列印憑證上不可回收的錯誤。

       本測試原本用 `getUTCFullYear/getUTCMonth`,於是每天 **16:00–24:00 UTC**
       這 8 小時(台北的隔日 00:00–08:00)必定失敗 —— 2026-08-01 00:43(台北)
       跑整套時實際踩到:程式得 202608、測試得 202607。
       ⚠️ 測試自己踩了它所驗證的那個 bug。 */
    const ym = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .replace("-", "")
    const r1 = await records.createRecord(tenantA, form.id, { 備註: "a" }, ACTOR)
    const r2 = await records.createRecord(tenantA, form.id, { 備註: "b" }, ACTOR)
    expect(r1.values.單號).toBe(`PO${ym}0001`)
    expect(r2.values.單號).toBe(`PO${ym}0002`)
  })

  it("resetScope=field → 各群組獨立跳號", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "分組單",
        fields: [
          { name: "類別", type: "singleSelect", options: { choices: ["A", "B"] } },
          {
            name: "編號",
            type: "autoNumber",
            options: { prefix: "", width: 3, resetScope: "field", resetField: "類別" },
          },
        ],
      }),
    )
    const a1 = await records.createRecord(tenantA, form.id, { 類別: "A" }, ACTOR)
    const a2 = await records.createRecord(tenantA, form.id, { 類別: "A" }, ACTOR)
    const b1 = await records.createRecord(tenantA, form.id, { 類別: "B" }, ACTOR)
    expect(a1.values.編號).toBe("001")
    expect(a2.values.編號).toBe("002")
    expect(b1.values.編號).toBe("001") // B 獨立序列
  })

  it("legacy autoNumber(無 pattern)→ 仍走全域 sequence", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "簡單單",
        fields: [
          { name: "號", type: "autoNumber", options: { prefix: "S-", width: 4 } },
          { name: "x", type: "text" },
        ],
      }),
    )
    const r1 = await records.createRecord(tenantA, form.id, { x: "1" }, ACTOR)
    const r2 = await records.createRecord(tenantA, form.id, { x: "2" }, ACTOR)
    expect(r1.values.號).toBe("S-0001")
    expect(r2.values.號).toBe("S-0002")
  })

  it("選項顏色 + 連動 options round-trip", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "顏色單",
        fields: [
          {
            name: "狀態",
            type: "singleSelect",
            options: { choices: ["新", "結"], colors: { 新: "c1", 結: "ok" } },
          },
          {
            name: "細項",
            type: "singleSelect",
            options: {
              choices: ["新A", "結B"],
              parentField: "狀態",
              optionParents: { 新A: ["新"], 結B: ["結"] },
            },
          },
        ],
      }),
    )
    const got = await metadata.getForm(tenantA, form.id)
    const st = got.fields.find((f) => f.name === "狀態")
    const detail = got.fields.find((f) => f.name === "細項")
    /* v2:顏色收進 choice 物件以 id 為錨(不再是以名稱為 key 的 side map,#105) */
    const stChoices = (st?.options as { choices: { name: string; color?: string }[] }).choices
    expect(stChoices.map((c) => [c.name, c.color])).toEqual([
      ["新", "c1"],
      ["結", "ok"],
    ])
    expect((detail?.options as { parentField?: string }).parentField).toBe("狀態")
    // valueSchema 仍 enum choices:寫入合法選項成功、非法拒
    const rec = await records.createRecord(tenantA, form.id, { 狀態: "新", 細項: "新A" }, ACTOR)
    expect(rec.values.狀態).toBe("新")
    await expect(records.createRecord(tenantA, form.id, { 狀態: "無效" }, ACTOR)).rejects.toThrow()
  })

  it("link displayFields options 保存", async () => {
    const target = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "供應商",
        fields: [
          { name: "名稱", type: "text", required: true },
          { name: "電話", type: "text" },
        ],
      }),
    )
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "採購",
        fields: [
          { name: "單號", type: "text", required: true },
          {
            name: "供應商",
            type: "link",
            options: { targetFormId: target.form.id, displayFields: ["名稱", "電話"] },
          },
        ],
      }),
    )
    const got = await metadata.getForm(tenantA, form.id)
    const link = got.fields.find((f) => f.name === "供應商")
    expect((link?.options as { displayFields?: string[] }).displayFields).toEqual(["名稱", "電話"])
  })
})

/* R1·UP-4c 選項配色:受控 tone 白名單 + colors↔choices 交叉驗證 */
describe("選項配色(option colors)", () => {
  // async 包裝:createFormSpecSchema.parse 為同步拋出,不包裝則 rejects 接不到
  const createSelectForm = async (options: Record<string, unknown>) =>
    ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `配色_${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 6)}`,
        fields: [{ name: "區域", type: "singleSelect", options }],
      }),
    )

  it("合法 tone(語意色 + 類別色)可存", async () => {
    const { fields } = await createSelectForm({
      choices: ["北區", "中區", "待審"],
      colors: { 北區: "c1", 中區: "c5", 待審: "warn" },
    })
    const choices = (fields[0]?.options as { choices: { name: string; color?: string }[] }).choices
    expect(choices.find((c) => c.name === "北區")?.color).toBe("c1")
  })

  it("任意字串 / hex 被拒(受控色盤,非自由選色)", async () => {
    await expect(
      createSelectForm({ choices: ["北區"], colors: { 北區: "#ff0000" } }),
    ).rejects.toThrow()
    await expect(
      createSelectForm({ choices: ["北區"], colors: { 北區: "sparkle" } }),
    ).rejects.toThrow()
  })

  /* FMEA C3 的保證在 v2 由**結構**提供,不再靠驗證(#105):
     顏色錨在 choice 的 stable id 上,指向不存在選項的顏色在正規化時就被丟棄,
     且改名後顏色跟著同一個 id 走 —— 同名的新選項不可能繼承到舊色。
     舊測試斷言的是「拒絕」,新測試斷言的是「不可能發生」。 */
  it("FMEA C3:指向不存在選項的顏色被丟棄,不會沾到任何選項", async () => {
    const { fields } = await createSelectForm({
      choices: ["北區"],
      colors: { 北區: "c1", 已刪除的選項: "c2" },
    })
    const choices = (fields[0]?.options as { choices: { name: string; color?: string }[] }).choices
    expect(choices).toHaveLength(1)
    expect(choices[0]?.color).toBe("c1")
  })

  it("未設 colors 仍可建(向後相容,既有欄位零遷移)", async () => {
    const { fields } = await createSelectForm({ choices: ["甲", "乙"] })
    const choices = (fields[0]?.options as { choices: { color?: string }[] }).choices
    expect(choices.every((c) => c.color === undefined)).toBe(true)
  })
})
