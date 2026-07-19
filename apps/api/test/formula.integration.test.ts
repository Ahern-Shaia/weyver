import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDdlKnex, createDrizzle, type DrizzleDb } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { formulaDefs, tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import {
  FieldNotFoundError,
  FormulaDefinitionError,
  FormulaReferenceError,
  FormulaSelfReferenceError,
} from "../src/form-engine/errors.js"
import { FormulaService } from "../src/form-engine/formula/formula.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { and, eq } from "drizzle-orm"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let formula: FormulaService
let knexDestroy: () => Promise<void>
let tenantA = 0
let formId = 0
const field: Record<string, number> = {}

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

  const metadata = new MetadataService(db)
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  const ddl = new DdlService(ddlKnex, db, metadata)
  formula = new FormulaService(db, metadata)

  const { fields } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "採購明細",
      fields: [
        { name: "單價", type: "money" },
        { name: "數量", type: "number" },
        { name: "稅率", type: "percent" },
        { name: "小計", type: "number" },
        { name: "狀態", type: "singleSelect", options: { choices: ["草稿", "核准"] } },
      ],
    }),
  )
  formId = fields[0]?.formId ?? 0
  for (const f of fields) field[f.name] = f.id
}, 120_000)

afterAll(async () => {
  await knexDestroy?.()
  await pool?.end()
  await container?.stop()
})

describe("FormulaService.defineFormula", () => {
  it("解析 + 依賴解析(名稱→id)+ 型別推斷 → 存 formula_def", async () => {
    const def = await formula.defineFormula(
      tenantA,
      formId,
      field.小計 ?? 0,
      "ROUND({單價} * {數量} * (1 + {稅率}), 2)",
    )
    expect(def.resultType).toBe("number")
    expect(new Set(def.dependsOn)).toEqual(new Set([field.單價, field.數量, field.稅率]))

    const stored = await db
      .select()
      .from(formulaDefs)
      .where(and(eq(formulaDefs.tenantId, tenantA), eq(formulaDefs.fieldId, field.小計 ?? 0)))
    expect(stored[0]?.exprSource).toContain("ROUND")
    expect(stored[0]?.resultType).toBe("number")
  })

  it("重定義同欄 → upsert(不重複列)", async () => {
    await formula.defineFormula(tenantA, formId, field.小計 ?? 0, "{單價} * {數量}")
    const stored = await db
      .select()
      .from(formulaDefs)
      .where(eq(formulaDefs.fieldId, field.小計 ?? 0))
    expect(stored.length).toBe(1)
    expect(stored[0]?.dependsOn).toEqual(expect.arrayContaining([field.單價, field.數量]))
  })

  it("參照不存在欄位 → FormulaReferenceError", async () => {
    await expect(
      formula.defineFormula(tenantA, formId, field.小計 ?? 0, "{單價} * {幽靈欄}"),
    ).rejects.toThrow(FormulaReferenceError)
  })

  it("自我參照 → FormulaSelfReferenceError", async () => {
    await expect(
      formula.defineFormula(tenantA, formId, field.小計 ?? 0, "{小計} + 1"),
    ).rejects.toThrow(FormulaSelfReferenceError)
  })

  it("語法錯 → FormulaDefinitionError", async () => {
    await expect(
      formula.defineFormula(tenantA, formId, field.小計 ?? 0, "{單價} * * 2"),
    ).rejects.toThrow(FormulaDefinitionError)
  })

  it("文字結果型別推斷", async () => {
    const def = await formula.defineFormula(tenantA, formId, field.小計 ?? 0, '{狀態} & "-完成"')
    expect(def.resultType).toBe("text")
  })

  it("欄位不存在 → FieldNotFoundError", async () => {
    await expect(formula.defineFormula(tenantA, formId, 999_999, "1 + 1")).rejects.toThrow(
      FieldNotFoundError,
    )
  })
})
