import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { FormNotFoundError } from "../src/form-engine/errors.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let service: MetadataService
let tenantA = 0
let tenantB = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0
  service = new MetadataService(db, new TenantDb(db))
})

afterAll(async () => {
  await pool.end()
  await container.stop()
})

describe("metadata catalog on real PG (Testcontainers)", () => {
  it("creates a form draft with generated physical identifiers", async () => {
    const spec = createFormSpecSchema.parse({
      name: "採購單",
      fields: [
        { name: "單號", type: "autoNumber", options: { prefix: "PO-" } },
        { name: "金額", type: "money" },
        { name: "供應商", type: "text", required: true },
      ],
    })
    const { form, fields } = await service.createFormDraft(tenantA, spec)

    expect(form.provisionState).toBe("pending")
    expect(form.physicalTable).toBe(`t${form.id}`)
    expect(fields).toHaveLength(3)
    for (const field of fields) {
      expect(field.physicalColumn).toBe(`f${field.id}`)
    }
    expect(fields.map((f) => f.position)).toEqual([0, 1, 2])
    expect(fields[1]?.dbFieldType).toBe("numeric")
    expect(fields[1]?.options).toEqual({ currency: "TWD" })
  })

  it("round-trips getForm and orders fields by position", async () => {
    const { form } = await service.createFormDraft(
      tenantA,
      createFormSpecSchema.parse({
        name: "品檢表",
        fields: [
          { name: "批號", type: "text" },
          { name: "結果", type: "singleSelect", options: { choices: ["合格", "不合格"] } },
        ],
      }),
    )
    const loaded = await service.getForm(tenantA, form.id)
    expect(loaded.form.name).toBe("品檢表")
    expect(loaded.fields.map((f) => f.name)).toEqual(["批號", "結果"])
  })

  it("enforces (tenant, name) uniqueness for live forms", async () => {
    await expect(
      service.createFormDraft(
        tenantA,
        createFormSpecSchema.parse({ name: "採購單", fields: [{ name: "x", type: "text" }] }),
      ),
    ).rejects.toThrow(/duplicate key|unique/i)
  })

  it("scopes every query by tenant — B 讀不到 A(鐵則 3 app 層)", async () => {
    const formsOfA = await service.listForms(tenantA)
    expect(formsOfA.length).toBeGreaterThan(0)
    const firstFormId = formsOfA[0]?.id ?? 0

    await expect(service.getForm(tenantB, firstFormId)).rejects.toThrow(FormNotFoundError)
    expect(await service.listForms(tenantB)).toHaveLength(0)
    await expect(service.markProvisioned(tenantB, firstFormId, "ready")).rejects.toThrow(
      FormNotFoundError,
    )
  })

  it("markProvisioned transitions pending → ready", async () => {
    const { form } = await service.createFormDraft(
      tenantB,
      createFormSpecSchema.parse({
        name: "供應商評鑑",
        fields: [{ name: "分數", type: "rating" }],
      }),
    )
    await service.markProvisioned(tenantB, form.id, "ready")
    const loaded = await service.getForm(tenantB, form.id)
    expect(loaded.form.provisionState).toBe("ready")
  })
})

describe("零欄位建表(#109)", () => {
  it("**空白表單可建立** —— 建表是「命名 → 進設計器」,欄位在設計器裡加", async () => {
    const { form, fields } = await service.createFormDraft(
      tenantA,
      createFormSpecSchema.parse({ name: `空白_${String(Date.now()).slice(-6)}`, fields: [] }),
    )
    expect(form.name).toContain("空白")
    expect(fields).toHaveLength(0)
  })
})
