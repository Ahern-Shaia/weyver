import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { eq } from "drizzle-orm"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { IdentityService } from "../src/auth/identity.service.js"
import { type DrizzleDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { users } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let identity: IdentityService

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri(), 5)
  await runMigrations(pool)
  db = createDrizzle(pool)
  identity = new IdentityService(db)
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("IdentityService — org↔tenant · user↔actor 對映(F-2 M2)", () => {
  it("ensureTenantForOrg 冪等:同 org 兩次 → 同 tenantId(不重建)", async () => {
    const first = await identity.ensureTenantForOrg({ authOrgId: "org_A", name: "廠 A" })
    const second = await identity.ensureTenantForOrg({
      authOrgId: "org_A",
      name: "廠 A(改名不生效)",
    })
    expect(second).toBe(first)
    expect(await identity.getTenantIdByOrg("org_A")).toBe(first)
  })

  it("不同 org → 不同 tenant(unique auth_org_id)", async () => {
    const a = await identity.ensureTenantForOrg({ authOrgId: "org_X", name: "X" })
    const b = await identity.ensureTenantForOrg({ authOrgId: "org_Y", name: "Y" })
    expect(a).not.toBe(b)
  })

  it("getTenantIdByOrg 未知 org → null", async () => {
    expect(await identity.getTenantIdByOrg("org_missing")).toBeNull()
  })

  it("upsertUser 冪等:同 auth user 兩次 → 同 actorId;email/name 漂移更新", async () => {
    const first = await identity.upsertUser({
      authUserId: "user_1",
      email: "old@weyver.test",
      name: "舊名",
    })
    const second = await identity.upsertUser({
      authUserId: "user_1",
      email: "new@weyver.test",
      name: "新名",
    })
    expect(second).toBe(first)
    const row = await db.select().from(users).where(eq(users.id, first))
    expect(row[0]?.email).toBe("new@weyver.test")
    expect(row[0]?.name).toBe("新名")
  })

  it("getActorIdByUser 未知 → null;軟刪使用者 → null;再 upsert 復活(清 deleted_at)", async () => {
    const actorId = await identity.upsertUser({
      authUserId: "user_2",
      email: "u2@weyver.test",
      name: null,
    })
    expect(await identity.getActorIdByUser("user_2")).toBe(actorId)
    expect(await identity.getActorIdByUser("user_unknown")).toBeNull()

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, actorId))
    expect(await identity.getActorIdByUser("user_2")).toBeNull()

    const revived = await identity.upsertUser({
      authUserId: "user_2",
      email: "u2@weyver.test",
      name: "回任",
    })
    expect(revived).toBe(actorId)
    expect(await identity.getActorIdByUser("user_2")).toBe(actorId)
  })
})
