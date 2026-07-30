import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { getMigrations } from "better-auth/db/migration"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AUTH } from "../src/auth/auth.tokens.js"
import type { Auth } from "../src/auth/auth.js"
import { runMigrations } from "../src/db/migrate.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let auth: Auth
let cookieA = ""
let cookieB = ""
let orgA1Id = ""
let orgA2Id = ""

const savedEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  APP_DATABASE_URL: process.env.APP_DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
}

function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ")
}

/* 註冊 → 建 org(afterCreateOrganization hook 建 tenant + 連結)→ 設 active org;回 session cookie。 */
async function onboard(email: string, name: string, slug: string, orgName: string): Promise<string> {
  const signUp = await auth.api.signUpEmail({
    body: { email, password: "s3cret-passw0rd", name },
    returnHeaders: true,
  })
  const cookie = cookiesFrom(signUp.headers)
  const org = await auth.api.createOrganization({
    headers: new Headers({ cookie }),
    body: { name: orgName, slug },
  })
  if (!org) throw new Error(`createOrganization returned null for ${slug}`)
  await auth.api.setActiveOrganization({
    headers: new Headers({ cookie }),
    body: { organizationId: org.id },
  })
  return cookie
}

const names = (res: { json: () => unknown }): string[] =>
  (res.json() as { name: string }[]).map((f) => f.name)

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)

  // prod 模式 → TenantGuard 分派至真實 AuthGuard(非 dev header)
  process.env.NODE_ENV = "production"
  process.env.BETTER_AUTH_SECRET = "x".repeat(48)
  process.env.DATABASE_URL = uri
  /* prod 模式禁止 app 車道與 migration 車道同一角色(否則 RLS 被 BYPASSRLS 旁路),
     故此處備妥真正的非特權登入角色 —— 與 record-scope 測同法。 */
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(uri)
  appUri.username = "app_login"
  appUri.password = "app_login"
  process.env.APP_DATABASE_URL = appUri.toString()
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  auth = app.get<Auth>(AUTH)
  const { runMigrations: runAuthMigrations } = await getMigrations(auth.options)
  await runAuthMigrations()

  cookieA = await onboard("a@weyver.test", "廠A管理員", "chang-a", "廠 A")
  cookieB = await onboard("b@weyver.test", "廠B管理員", "chang-b", "廠 B")

  /* F-10:同一個人再開第二家 —— 這正是本產品的實際模式(一人導入 17 家),
     也是跨分頁污染的必要前提。orgA2 建立後 active org 會停在 A2。 */
  const org2 = await auth.api.createOrganization({
    headers: new Headers({ cookie: cookieA }),
    body: { name: "廠 A2", slug: "chang-a2" },
  })
  orgA2Id = org2?.id ?? ""
  const orgs = await auth.api.listOrganizations({ headers: new Headers({ cookie: cookieA }) })
  orgA1Id = orgs.find((o) => o.slug === "chang-a")?.id ?? ""
  await auth.api.setActiveOrganization({
    headers: new Headers({ cookie: cookieA }),
    body: { organizationId: orgA1Id },
  })
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
  Object.assign(process.env, savedEnv)
})

describe("AuthGuard 租戶隔離(F-2 M3;prod session)", () => {
  it("無 session → 401 UNAUTHENTICATED(dev header 在 prod 完全不被採信)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/forms",
      headers: { "x-dev-tenant": "1" },
    })
    expect(res.statusCode).toBe(401)
    expect((res.json() as { code: string }).code).toBe("UNAUTHENTICATED")
  })

  it("A 登入 → 建表 → 讀得到自己的表", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: { cookie: cookieA },
      payload: { name: "A採購單", fields: [{ name: "供應商", type: "text" }] },
    })
    expect(create.statusCode).toBe(201)

    const listA = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie: cookieA } })
    expect(listA.statusCode).toBe(200)
    expect(names(listA)).toContain("A採購單")
  })

  it("B 登入 → 讀不到 A 的表(租戶隔離)", async () => {
    const listB = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie: cookieB } })
    expect(listB.statusCode).toBe(200)
    expect(names(listB)).not.toContain("A採購單")
  })

  it("偽造 x-tenant-id / x-dev-tenant 無效:租戶只出自 session(A 仍是 A)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/forms",
      headers: { cookie: cookieA, "x-tenant-id": "999999", "x-dev-tenant": "999999" },
    })
    expect(res.statusCode).toBe(200)
    expect(names(res)).toContain("A採購單")
  })

  it("有 session 但無 active org → 403 NO_ACTIVE_ORG", async () => {
    const signUp = await auth.api.signUpEmail({
      body: { email: "c@weyver.test", password: "s3cret-passw0rd", name: "C" },
      returnHeaders: true,
    })
    const cookieC = cookiesFrom(signUp.headers)
    const res = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie: cookieC } })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { code: string }).code).toBe("NO_ACTIVE_ORG")
  })
})

describe("🔴 成員撤銷必須立即生效(追溯稽核 P0)", () => {
  it("**被移出組織後,舊 session 立刻失效** —— 不驗成員資格則移除成員形同 no-op", async () => {
    const cookie = await onboard("revoked@w.test", "待撤銷", "revoke-co", "撤銷測試公司")

    // 撤銷前:可正常存取
    const before = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie } })
    expect(before.statusCode).toBe(200)

    /* 直接從 member 表移除 —— 等同管理員移除他人。
       Better Auth 的 removeMember 只在「使用者移除自己且正是當前 session」時清
       activeOrganizationId,故被移除者的 session cookie 依然有效且仍帶著 activeOrg。 */
    const org = await pool.query<{ id: string }>(
      `SELECT o.id FROM "organization" o WHERE o.slug = 'revoke-co'`,
    )
    const orgId = org.rows[0]?.id ?? ""
    expect(orgId).not.toBe("")
    const del = await pool.query(`DELETE FROM "member" WHERE "organizationId" = $1`, [orgId])
    expect(del.rowCount).toBeGreaterThan(0)

    // 撤銷後:同一個 cookie 必須被拒
    const after = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie } })
    expect(after.statusCode).toBe(403)
    expect((after.json() as { code: string }).code).toBe("NOT_ORG_MEMBER")
  })
})

/* 🔴 F-10|分頁級租戶上下文。重現的是本產品的實際模式:**一個人管多家公司**,
   多分頁各開一家。租戶原本綁在整個瀏覽器共用的 session 列上,
   分頁 2 切公司會改到分頁 1 的租戶 → 分頁 1 的下一次寫入落到錯的公司。 */
describe("F-10 分頁級租戶上下文", () => {
  it("不帶 intent → 維持既有行為(以 session 的 active org 為準)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie: cookieA } })
    expect(res.statusCode).toBe(200)
  })

  it("intent 與 session 相同 → 一切照舊", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/forms",
      headers: { cookie: cookieA, "x-weyver-org-intent": orgA1Id },
    })
    expect(res.statusCode).toBe(200)
  })

  it("🔴 讀取:intent 指向另一家自己的公司 → 放行,且讀到的是那一家", async () => {
    /* 先在 A2 建一張表(用 intent 讀不到它才有意義) */
    await auth.api.setActiveOrganization({
      headers: new Headers({ cookie: cookieA }),
      body: { organizationId: orgA2Id },
    })
    const create = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: { cookie: cookieA },
      payload: { name: "A2專用表", fields: [{ name: "欄", type: "text" }] },
    })
    expect(create.statusCode).toBe(201)
    await auth.api.setActiveOrganization({
      headers: new Headers({ cookie: cookieA }),
      body: { organizationId: orgA1Id },
    })

    // session 現在是 A1;帶 A2 的 intent 讀 → 應看到 A2 的表
    const res = await app.inject({
      method: "GET",
      url: "/api/forms",
      headers: { cookie: cookieA, "x-weyver-org-intent": orgA2Id },
    })
    expect(res.statusCode).toBe(200)
    expect(names(res)).toContain("A2專用表")

    // 不帶 intent 則看到 A1 的,證明兩者確實解析到不同租戶
    const plain = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie: cookieA } })
    expect(names(plain)).not.toContain("A2專用表")
  })

  it("🔴 寫入:intent 與 session 不符 → 409 TENANT_CONTEXT_MISMATCH,**不寫入任何一邊**", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: { cookie: cookieA, "x-weyver-org-intent": orgA2Id },
      payload: { name: "不該被建立的表", fields: [{ name: "欄", type: "text" }] },
    })
    expect(res.statusCode).toBe(409)
    /* 信封維持統一四欄(AGENTS 橫切鐵則)—— 前端本來就知道自己送了哪個 intent,
       目前的 active org 也讀得到,不需要伺服器回傳 */
    expect((res.json() as { code: string }).code).toBe("TENANT_CONTEXT_MISMATCH")

    for (const [label, intent] of [["A1", orgA1Id], ["A2", orgA2Id]] as const) {
      const list = await app.inject({
        method: "GET",
        url: "/api/forms",
        headers: { cookie: cookieA, "x-weyver-org-intent": intent },
      })
      expect(names(list), `${label} 不該有這張表`).not.toContain("不該被建立的表")
    }
  })

  it("🔴 intent 指向**非成員**的公司 → 403,不是靜默採用(這是 intent 與授權結論的分界)", async () => {
    const orgsB = await auth.api.listOrganizations({ headers: new Headers({ cookie: cookieB }) })
    const orgBId = orgsB[0]?.id ?? ""
    expect(orgBId).not.toBe("")

    const res = await app.inject({
      method: "GET",
      url: "/api/forms",
      headers: { cookie: cookieA, "x-weyver-org-intent": orgBId },
    })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { code: string }).code).toBe("NOT_ORG_MEMBER")
  })

  it("intent 不改寫 session(否則污染會反向傳播回另一個分頁)", async () => {
    await app.inject({
      method: "GET",
      url: "/api/forms",
      headers: { cookie: cookieA, "x-weyver-org-intent": orgA2Id },
    })
    const after = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie: cookieA } })
    // 不帶 intent 仍是 A1 → session 未被改寫
    expect(names(after)).not.toContain("A2專用表")
  })
})
