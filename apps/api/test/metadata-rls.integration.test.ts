import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { and, eq, isNull } from "drizzle-orm"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { formDefs, tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* F-6 M3|metadata 車道 RLS 兜底(form-engine-core FMEA T4)。

   關鍵:以**真實非 superuser 角色**(app_login → weyver_app)連線,
   斷言「即使查詢漏寫 WHERE tenant_id,RLS 仍不讓他租戶的 metadata 外洩」。
   切換前此斷言必失敗(特權連線繞過 RLS)—— 這正是本里程碑要修的單防線問題。 */

let container: StartedPostgreSqlContainer
let adminPool: pg.Pool
let appPool: pg.Pool
let adminDb: DrizzleDb
let appTenantDb: TenantDb
let metadataViaApp: MetadataService
const destroyers: (() => Promise<unknown>)[] = []

let tenantA = 0
let tenantB = 0
let formA = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  adminPool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(adminPool)
  await adminPool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  adminDb = createDrizzle(adminPool)

  const rows = await adminDb
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0

  const uri = new URL(container.getConnectionUri())
  uri.username = "app_login"
  uri.password = "app_login"
  appPool = new pg.Pool({ connectionString: uri.toString(), max: 5 })
  appTenantDb = new TenantDb(createDrizzle(appPool))
  metadataViaApp = new MetadataService(adminDb, appTenantDb)

  // 建表走特權 DDL 車道(需 CREATE);metadata 讀寫則走 app 車道
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  destroyers.push(() => ddlKnex.destroy())
  const ddl = new DdlService(ddlKnex, adminDb, metadataViaApp)
  const created = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "採購單",
      fields: [{ name: "供應商", type: "text", required: true }],
    }),
  )
  formA = created.form.id
}, 180_000)

afterAll(async () => {
  for (const destroy of destroyers) await destroy()
  await appPool?.end()
  await adminPool?.end()
  await container?.stop()
})

describe("F-6 M3 metadata 車道 RLS 兜底(T4)", () => {
  it("app 車道以非 superuser 連線 → 既有 RLS FORCE 生效", async () => {
    const rows = await appPool.query<{ current_user: string; is_super: boolean }>(
      "SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super",
    )
    expect(rows.rows[0]?.current_user).toBe("app_login")
    expect(rows.rows[0]?.is_super).toBe(false)
  })

  it("**漏寫 WHERE tenant_id 也不外洩**:B 租戶語境查全表 → 讀不到 A 的表單", async () => {
    // 刻意不加 tenant 條件 —— 模擬未來某處漏寫 app 層防線
    const asB = await appTenantDb.withTenant(tenantB, (tx) =>
      tx.select({ id: formDefs.id }).from(formDefs).where(isNull(formDefs.deletedAt)),
    )
    expect(asB.map((r) => r.id)).not.toContain(formA)
    expect(asB).toHaveLength(0)

    const asA = await appTenantDb.withTenant(tenantA, (tx) =>
      tx.select({ id: formDefs.id }).from(formDefs).where(isNull(formDefs.deletedAt)),
    )
    expect(asA.map((r) => r.id)).toContain(formA)
  })

  it("MetadataService 於 B 租戶語境取 A 的表單 → FormNotFound(雙防線一致)", async () => {
    await expect(metadataViaApp.getForm(tenantB, formA)).rejects.toThrow()
    await expect(metadataViaApp.getForm(tenantA, formA)).resolves.toBeDefined()
  })

  it("跨租戶寫入亦被擋:B 語境更新 A 的表單 → 0 列受影響", async () => {
    const updated = await appTenantDb.withTenant(tenantB, (tx) =>
      tx
        .update(formDefs)
        .set({ name: "被竄改" })
        .where(eq(formDefs.id, formA))
        .returning({ id: formDefs.id }),
    )
    expect(updated).toHaveLength(0)

    const intact = await appTenantDb.withTenant(tenantA, (tx) =>
      tx
        .select({ name: formDefs.name })
        .from(formDefs)
        .where(and(eq(formDefs.id, formA), isNull(formDefs.deletedAt))),
    )
    expect(intact[0]?.name).toBe("採購單")
  })
})
