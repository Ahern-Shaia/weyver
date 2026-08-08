import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { and, eq } from "drizzle-orm"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { formulaDefs, tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { FormulaService } from "../src/form-engine/formula/formula.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { listQuerySchema } from "../src/form-engine/records/record-specs.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

const ACTOR = 1

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let records: RecordService
let knexDestroy: () => Promise<void>
let tenantA = 0
let formId = 0
let subtotalFieldId = 0
let rec1 = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri(), 8)
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
  const formula = new FormulaService(new TenantDb(db), metadata)
  // 關鍵:formula 注入 DdlService(建表自動 defineFormula)+ RecordService(讀時算注入)
  const ddl = new DdlService(ddlKnex, db, metadata, formula)
  records = new RecordService(ddlKnex, metadata, formula)

  const form = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "採購明細",
      fields: [
        { name: "單價", type: "money" },
        { name: "數量", type: "number" },
        { name: "小計", type: "formula", options: { expression: "{單價} * {數量}" } },
      ],
    }),
  )
  formId = form.form.id
  subtotalFieldId = form.fields.find((f) => f.name === "小計")?.id ?? 0

  // 單價 為 money(傳字串);數量 為 number(傳 JS number)
  const r1 = await records.createRecord(tenantA, formId, { 單價: "12.5", 數量: 4 }, ACTOR)
  rec1 = r1.id
  await records.createRecord(tenantA, formId, { 單價: "10", 數量: 3 }, ACTOR)
}, 120_000)

afterAll(async () => {
  await knexDestroy?.()
  await pool?.end()
  await container?.stop()
})

describe("公式欄端到端(M6):createForm 自動註冊 + 讀時算注入", () => {
  it("createForm 自動註冊 formula_def(依賴 + 型別)", async () => {
    const defs = await db
      .select()
      .from(formulaDefs)
      .where(and(eq(formulaDefs.tenantId, tenantA), eq(formulaDefs.fieldId, subtotalFieldId)))
    expect(defs.length).toBe(1)
    expect(defs[0]?.resultType).toBe("number")
    expect(defs[0]?.exprSource).toBe("{單價} * {數量}")
  })

  it("getRecord 讀時算注入 小計(12.5 × 4 = 50;使用者未寫入 systemManaged 欄)", async () => {
    const got = await records.getRecord(tenantA, formId, rec1)
    expect(got.values.小計).toBe("50")
  })

  it("listRecords 逐列注入(不同記錄不同值)", async () => {
    const { records: list } = await records.listRecords(tenantA, formId, listQuerySchema.parse({}))
    const values = list.map((r) => r.values.小計)
    expect(values).toContain("50") // 12.5 × 4
    expect(values).toContain("30") // 10 × 3
  })
})
