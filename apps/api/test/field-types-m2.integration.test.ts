import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDdlKnex, createDrizzle, type DrizzleDb, TenantDb } from "../src/db/db.module.js"
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
    const now = new Date()
    const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`
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
            options: { choices: ["新", "結"], colors: { 新: "info", 結: "ok" } },
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
    expect((st?.options as { colors?: Record<string, string> }).colors).toEqual({
      新: "info",
      結: "ok",
    })
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
