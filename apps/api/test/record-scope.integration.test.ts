import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { EffectivePermissions } from "../src/authz/authz-effective.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 #96 E-1 記錄範圍。強制點在 `AS RESTRICTIVE` RLS policy(OQ-DP-7=B)——
   實測與應用層注入執行計畫相同,但語意恆為 AND:使用者篩選的 OR 逃不出去,
   且應用層漏注入也不外洩。 */

const ALICE = 101
const BOB = 202
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
/* 建表走特權 DDL 車道(需 CREATE);記錄讀寫走 **app 角色**車道 ——
   superuser 一律 bypass RLS,用它測範圍等於什麼都沒測。 */
let records: RecordService
const destroyers: (() => Promise<void>)[] = []
let tenantA = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db.insert(tenants).values([{ name: "廠 A" }]).returning()
  tenantA = rows[0]?.id ?? 0
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  destroyers.push(() => ddlKnex.destroy())
  ddl = new DdlService(ddlKnex, db, metadata)

  const uri = new URL(container.getConnectionUri())
  uri.username = "app_login"
  uri.password = "app_login"
  const appKnex = createDdlKnex(uri.toString())
  destroyers.push(() => appKnex.destroy())
  records = new RecordService(appKnex, metadata)
}, 120_000)

afterAll(async () => {
  for (const d of destroyers) await d()
  await pool.end()
  await container.stop()
})

/* 只受 own 限制的 view 權限 */
const ownScoped = (formId: number): EffectivePermissions =>
  new EffectivePermissions(
    false,
    new Map([[formId, new Set(["view", "edit"] as const)]]),
    new Map(),
    new Set(),
    new Map([[formId, new Set(["view"] as const)]]),
  )

const allScoped = (formId: number): EffectivePermissions =>
  new EffectivePermissions(
    false,
    new Map([[formId, new Set(["view", "edit"] as const)]]),
    new Map(),
    new Set(),
  )

async function seed(): Promise<number> {
  const { form } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: `客戶_${String(Date.now()).slice(-6)}`,
      fields: [{ name: "客戶名稱", type: "text" }],
    }),
    ALICE,
  )
  await records.createRecord(tenantA, form.id, { 客戶名稱: "A的客戶1" }, ALICE)
  await records.createRecord(tenantA, form.id, { 客戶名稱: "A的客戶2" }, ALICE)
  await records.createRecord(tenantA, form.id, { 客戶名稱: "B的客戶" }, BOB)
  return form.id
}

const names = async (
  formId: number,
  perms: EffectivePermissions,
  actorId: number,
): Promise<string[]> => {
  const page = await records.listRecords(
    tenantA,
    formId,
    { filters: [], sort: [], limit: 50 },
    perms,
    actorId,
  )
  return page.records.map((r) => String(r.values.客戶名稱)).sort()
}

describe("🔴 記錄範圍:業務只看自己的客戶(#96)", () => {
  it("**own 範圍下只看得到自己建立的** —— Weyver 原本表單可見即所有記錄可見", async () => {
    const formId = await seed()
    expect(await names(formId, ownScoped(formId), ALICE)).toEqual(["A的客戶1", "A的客戶2"])
    expect(await names(formId, ownScoped(formId), BOB)).toEqual(["B的客戶"])
  })

  it("未設範圍時看得到全部(既有行為,零遷移)", async () => {
    const formId = await seed()
    expect(await names(formId, allScoped(formId), ALICE)).toHaveLength(3)
  })

  it("**強制點在 DB** —— 就算應用層完全不傳 policy,GUC 設了 own 仍濾得掉", async () => {
    const formId = await seed()
    // 直接對 DB 驗:設 own + actor=BOB,無論應用層做什麼都只剩 1 筆
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE weyver_app")
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantA)])
      await client.query(`SELECT set_config('app.record_scope', 'own', true)`)
      await client.query(`SELECT set_config('app.actor_id', $1, true)`, [String(BOB)])
      const res = await client.query(`SELECT count(*)::int AS n FROM data.t${formId}`)
      expect(res.rows[0].n).toBe(1)
      await client.query("ROLLBACK")
    } finally {
      client.release()
    }
  })

  it("**使用者自訂篩選的 OR 逃不出範圍** —— RESTRICTIVE 語意恆為 AND", async () => {
    const formId = await seed()
    const page = await records.listRecords(
      tenantA,
      formId,
      {
        filters: [
          { field: "客戶名稱", op: "contains", value: "A的" },
          { field: "客戶名稱", op: "contains", value: "B的" },
        ],
        combinator: "or",
        sort: [],
        limit: 50,
      },
      ownScoped(formId),
      ALICE,
    )
    // OR 讓兩邊都命中,但 RESTRICTIVE 仍把 B 的擋在外面
    expect(page.records.map((r) => String(r.values.客戶名稱)).sort()).toEqual([
      "A的客戶1",
      "A的客戶2",
    ])
  })

  it("被指派者看得到(assignees)—— 這是 Ragic 賴以達成此需求的機制", async () => {
    const formId = await seed()
    await pool.query(`UPDATE data.t${formId} SET assignees = ARRAY[$1::bigint] WHERE created_by = $2`, [
      BOB,
      ALICE,
    ])
    expect(await names(formId, ownScoped(formId), BOB)).toEqual([
      "A的客戶1",
      "A的客戶2",
      "B的客戶",
    ])
  })
})
