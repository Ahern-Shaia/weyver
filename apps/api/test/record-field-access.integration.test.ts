import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FieldAccessPolicy } from "../src/authz/authz-effective.js"
import type { FieldVisibility } from "../src/authz/authz-model.js"
import { createDdlKnex, createDrizzle, type DrizzleDb, TenantDb } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { FieldForbiddenError } from "../src/form-engine/errors.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

const ACTOR = 1

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let ddlDestroy: () => Promise<void>
let records: RecordService
let metadata: MetadataService
let tenantA = 0
let formId = 0
let fieldIdByName = new Map<string, number>()

/* 由 fieldId→可見性 map 造 policy;未列預設 write(可見可寫)。 */
function policyOf(vis: Map<number, FieldVisibility>): FieldAccessPolicy {
  return { fieldVisibility: (fieldId) => vis.get(fieldId) ?? "write" }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  const db: DrizzleDb = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  ddlDestroy = () => ddlKnex.destroy()
  const ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)

  const { form } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "採購單",
      fields: [
        { name: "供應商", type: "text", required: true },
        { name: "金額", type: "money" },
        { name: "狀態", type: "singleSelect", options: { choices: ["草稿", "待審", "核准"] } },
      ],
    }),
  )
  formId = form.id
  const loaded = await metadata.getForm(tenantA, formId)
  fieldIdByName = new Map(loaded.fields.map((f) => [f.name, f.id]))
}, 120_000)

afterAll(async () => {
  await ddlDestroy()
  await pool.end()
})

describe("欄位級授權:讀遮罩 + 寫白名單(P0-4a M4)", () => {
  it("讀遮罩:hidden 欄不出現在回應(後端不回)", async () => {
    const created = await records.createRecord(
      tenantA,
      formId,
      { 供應商: "鑫豐", 金額: "128400.00", 狀態: "草稿" },
      ACTOR,
    )
    const moneyId = fieldIdByName.get("金額") ?? 0
    const policy = policyOf(new Map([[moneyId, "hidden"]]))

    const read = await records.getRecord(tenantA, formId, created.id, policy)
    expect(read.values.供應商).toBe("鑫豐")
    expect("金額" in read.values).toBe(false) // 遮罩:金額欄不回
    expect(read.values.狀態).toBe("草稿")
  })

  it("無 policy → 不遮罩(既有呼叫向後相容)", async () => {
    const created = await records.createRecord(
      tenantA,
      formId,
      { 供應商: "統鮮", 金額: "5000.00" },
      ACTOR,
    )
    const read = await records.getRecord(tenantA, formId, created.id)
    expect(read.values.金額).toBe("5000.0000") // money numeric scale 4
  })

  it("寫白名單:寫入非 write 權欄 → FieldForbiddenError(擋 mass-assignment)", async () => {
    const statusId = fieldIdByName.get("狀態") ?? 0
    const policy = policyOf(new Map([[statusId, "read"]])) // 狀態唯讀
    await expect(
      records.createRecord(tenantA, formId, { 供應商: "正大", 狀態: "核准" }, ACTOR, policy),
    ).rejects.toBeInstanceOf(FieldForbiddenError)
  })

  it("寫白名單:只寫可寫欄 → 成功", async () => {
    const statusId = fieldIdByName.get("狀態") ?? 0
    const policy = policyOf(new Map([[statusId, "read"]]))
    const ok = await records.createRecord(tenantA, formId, { 供應商: "永豐" }, ACTOR, policy)
    expect(ok.values.供應商).toBe("永豐")
  })

  it("list 遮罩:hidden 欄在列表也不回", async () => {
    const moneyId = fieldIdByName.get("金額") ?? 0
    const policy = policyOf(new Map([[moneyId, "hidden"]]))
    const { records: rows } = await records.listRecords(
      tenantA,
      formId,
      { filters: [], sort: [], limit: 50 },
      policy,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect("金額" in r.values).toBe(false)
  })
})
