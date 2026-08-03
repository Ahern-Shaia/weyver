import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { eq } from "drizzle-orm"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { relationDefs, tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import {
  NotALinkFieldError,
  RecordNotFoundError,
  UnknownFieldError,
} from "../src/form-engine/errors.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { RelationService } from "../src/form-engine/relations/relation.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

const ACTOR = 1

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let relations: RelationService
let knexDestroy: () => Promise<void>
let tenantA = 0
let supplierFormId = 0
let poFormId = 0
let supplierRecId = 0

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

  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  const ddl = new DdlService(ddlKnex, db, metadata)
  const records = new RecordService(ddlKnex, metadata)
  relations = new RelationService(new TenantDb(db), metadata, records)

  const supplier = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "供應商",
      fields: [
        { name: "名稱", type: "text", required: true },
        { name: "地址", type: "text" },
        { name: "電話", type: "phone" },
      ],
    }),
  )
  supplierFormId = supplier.form.id
  const rec = await records.createRecord(
    tenantA,
    supplierFormId,
    { 名稱: "鑫豐農產", 地址: "台南市善化區", 電話: "06-1234567" },
    ACTOR,
  )
  supplierRecId = rec.id

  const po = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "採購單",
      fields: [
        { name: "單號", type: "text" },
        { name: "供應商", type: "link", options: { targetFormId: supplierFormId } },
      ],
    }),
  )
  poFormId = po.form.id
}, 120_000)

afterAll(async () => {
  await knexDestroy?.()
  await pool?.end()
  await container?.stop()
})

describe("RelationService — Link + Load(M3)", () => {
  it("Load 帶入:link 欄指向供應商 → 讀指定欄", async () => {
    const loaded = await relations.load(tenantA, poFormId, "供應商", supplierRecId, [
      "地址",
      "電話",
    ])
    expect(loaded.地址).toBe("台南市善化區")
    expect(loaded.電話).toBe("06-1234567")
  })

  it("Load 全欄(未指定 loadFieldNames)", async () => {
    const loaded = await relations.load(tenantA, poFormId, "供應商", supplierRecId)
    expect(loaded.名稱).toBe("鑫豐農產")
  })

  it("registerRelation 寫入 relation_def(idempotent 不重複)", async () => {
    await relations.registerRelation(tenantA, poFormId, "供應商")
    await relations.registerRelation(tenantA, poFormId, "供應商")
    const defs = await db.select().from(relationDefs).where(eq(relationDefs.formId, poFormId))
    expect(defs.length).toBe(1)
    expect(defs[0]?.targetFormId).toBe(supplierFormId)
  })

  it("非 link 欄 → NotALinkFieldError", async () => {
    await expect(relations.load(tenantA, poFormId, "單號", supplierRecId)).rejects.toThrow(
      NotALinkFieldError,
    )
  })

  it("Load 不存在的目標欄 → UnknownFieldError", async () => {
    await expect(
      relations.load(tenantA, poFormId, "供應商", supplierRecId, ["幽靈欄"]),
    ).rejects.toThrow(UnknownFieldError)
  })

  it("目標 record 不存在 → RecordNotFoundError", async () => {
    await expect(relations.load(tenantA, poFormId, "供應商", 999_999)).rejects.toThrow(
      RecordNotFoundError,
    )
  })
})
