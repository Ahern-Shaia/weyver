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
  process.env.APP_DATABASE_URL = uri
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
