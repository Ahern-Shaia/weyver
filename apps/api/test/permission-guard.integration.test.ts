import { type ExecutionContext, ForbiddenException } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { RequiresFormAction, SelfService } from "../src/authz/authz-http.js"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { PermissionGuard } from "../src/authz/permission.guard.js"
import { PermissionService } from "../src/authz/permission.service.js"
import { type DrizzleDb, TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { formDefs, tenants, users } from "../src/db/schema.js"
import type { TenantContext } from "../src/http/tenant-context.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let guard: PermissionGuard

let tenantA: number
let tenantB: number
let actorAdmin: number
let actorReader: number
let actorNone: number
let formA: number

function need<T>(v: T | undefined | null, m: string): T {
  if (v === undefined || v === null) throw new Error(m)
  return v
}

/* 帶 @RequiresFormLevel("manage") 的 handler,供測設計器路由的 manage 檢查 */
class DummyController {
  @RequiresFormAction("design")
  manageRoute(): void {}

  /* 自助端點:個人設定 / 我的代理人 —— 作用對象恆為操作者自己 */
  @SelfService()
  selfRoute(): void {}
}

const handlerOf = (name: "manageRoute" | "selfRoute"): ((...a: unknown[]) => unknown) =>
  DummyController.prototype[name] as unknown as (...a: unknown[]) => unknown

function ctxFor(
  request: { method: string; params: Record<string, string>; tenantContext?: TenantContext },
  handler: (...args: unknown[]) => unknown = () => undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => DummyController,
  } as unknown as ExecutionContext
}

const tc = (tenantId: number, actorId: number): TenantContext => ({ tenantId, actorId })

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri(), 5)
  await runMigrations(pool)
  db = createDrizzle(pool)
  const repo = new AuthzRepository(db, new TenantDb(db))
  guard = new PermissionGuard(new PermissionService(repo), new Reflector())

  const tA = await db
    .insert(tenants)
    .values({ name: "A", authOrgId: "og_A" })
    .returning({ id: tenants.id })
  tenantA = need(tA[0], "tenantA").id
  const tB = await db
    .insert(tenants)
    .values({ name: "B", authOrgId: "og_B" })
    .returning({ id: tenants.id })
  tenantB = need(tB[0], "tenantB").id
  const mk = async (u: string): Promise<number> => {
    const r = await db
      .insert(users)
      .values({ authUserId: u, email: `${u}@t`, name: u })
      .returning({ id: users.id })
    return need(r[0], u).id
  }
  actorAdmin = await mk("admin")
  actorReader = await mk("reader")
  actorNone = await mk("none")

  const f = await db
    .insert(formDefs)
    .values({ tenantId: tenantA, name: "採購單" })
    .returning({ id: formDefs.id })
  formA = need(f[0], "formA").id

  await repo.seedSystemRoles(tenantA)
  await repo.assignActorToSystemRole(tenantA, "admin", actorAdmin)
  const reader = await repo.createRole({
    tenantId: tenantA,
    key: "reader",
    name: "讀者",
    parentId: null,
  })
  await repo.setFormActions(reader.id, formA, ["view"])
  await repo.assignMember(tenantA, reader.id, actorReader)
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("PermissionGuard 表單級執法(P0-4a M3)", () => {
  it("dev isSuperAdmin → 全放行(不查 DB)", async () => {
    const ctx = ctxFor({
      method: "POST",
      params: { formId: String(formA) },
      tenantContext: { ...tc(tenantA, actorNone), isSuperAdmin: true },
    })
    await expect(guard.canActivate(ctx)).resolves.toBe(true)
  })

  it("reader:GET(read)放行、POST(write)→ 403", async () => {
    const get = ctxFor({
      method: "GET",
      params: { formId: String(formA) },
      tenantContext: tc(tenantA, actorReader),
    })
    await expect(guard.canActivate(get)).resolves.toBe(true)
    const post = ctxFor({
      method: "POST",
      params: { formId: String(formA) },
      tenantContext: tc(tenantA, actorReader),
    })
    await expect(guard.canActivate(post)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("無角色 actor:deny-by-default → 連 GET 都 403", async () => {
    const get = ctxFor({
      method: "GET",
      params: { formId: String(formA) },
      tenantContext: tc(tenantA, actorNone),
    })
    await expect(guard.canActivate(get)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("admin:任何方法皆放行,含 manage 路由", async () => {
    const post = ctxFor({
      method: "POST",
      params: { formId: String(formA) },
      tenantContext: tc(tenantA, actorAdmin),
    })
    await expect(guard.canActivate(post)).resolves.toBe(true)
    const manage = ctxFor(
      {
        method: "PATCH",
        params: { formId: String(formA) },
        tenantContext: tc(tenantA, actorAdmin),
      },
      new DummyController().manageRoute,
    )
    await expect(guard.canActivate(manage)).resolves.toBe(true)
  })

  it("reader 對 manage 路由 → 403(read < manage)", async () => {
    const manage = ctxFor(
      { method: "GET", params: { formId: String(formA) }, tenantContext: tc(tenantA, actorReader) },
      new DummyController().manageRoute,
    )
    await expect(guard.canActivate(manage)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("無 formId + 寫(建表):非 admin → 403,admin → 放行", async () => {
    const nonAdmin = ctxFor({ method: "POST", params: {}, tenantContext: tc(tenantA, actorReader) })
    await expect(guard.canActivate(nonAdmin)).rejects.toBeInstanceOf(ForbiddenException)
    const admin = ctxFor({ method: "POST", params: {}, tenantContext: tc(tenantA, actorAdmin) })
    await expect(guard.canActivate(admin)).resolves.toBe(true)
  })

  it("跨租戶:用 tenantB context 存取 A 的表單 → 403(B 對 formA 無權)", async () => {
    const ctx = ctxFor({
      method: "GET",
      params: { formId: String(formA) },
      tenantContext: tc(tenantB, actorReader),
    })
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException)
  })
})

/* 🔴 自助端點。這一段是**真實缺陷**的回歸:`PATCH /api/settings/me` 對無角色使用者
   回 403 —— 一般員工連自己的語言時區都改不了。

   為什麼從沒被發現:dev 一律 `isSuperAdmin`,而在此之前**沒有任何測試送過
   `x-dev-real-authz`**,所以「無 formId 的寫入需 admin」這條分支從來沒有人走過。
   同型的坑已經出現多次:只在某個環境生效的規則,等於從來沒有人驗證過。 */
describe("🔴 自助端點不受「無 formId 的寫入需 admin」所限", () => {
  it("🔴 無任何角色的人可以寫自己的東西", async () => {
    const req = {
      method: "PATCH",
      params: {},
      tenantContext: tc(tenantA, actorNone),
    }
    await expect(guard.canActivate(ctxFor(req, handlerOf("selfRoute")))).resolves.toBe(true)
  })

  it("沒標記時仍維持原本的 admin 要求(建表 / 租戶設定的保護不動)", async () => {
    const req = { method: "PATCH", params: {}, tenantContext: tc(tenantA, actorNone) }
    await expect(guard.canActivate(ctxFor(req))).rejects.toThrow(ForbiddenException)
  })

  it("自助標記**不會**放寬有 formId 的路由 —— 免得被誤用成萬用旁路", async () => {
    const req = {
      method: "PATCH",
      params: { formId: String(formA) },
      tenantContext: tc(tenantA, actorNone),
    }
    await expect(guard.canActivate(ctxFor(req, handlerOf("selfRoute")))).rejects.toThrow(
      ForbiddenException,
    )
  })
})
