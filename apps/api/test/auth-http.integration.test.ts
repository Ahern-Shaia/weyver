import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { getMigrations } from "better-auth/db/migration"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Auth } from "../src/auth/auth.js"
import { AUTH } from "../src/auth/auth.tokens.js"
import { runMigrations } from "../src/db/migrate.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let auth: Auth

const savedEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  APP_DATABASE_URL: process.env.APP_DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  MALWARE_SCAN_ACK_DISABLED: process.env.MALWARE_SCAN_ACK_DISABLED,
}

function cookieFromInject(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  return arr
    .map((c) => c.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ")
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)

  process.env.NODE_ENV = "production"
  /* F-11:prod 停用掃毒須顯式承認(掃毒器 M3 才接);此處聚焦 auth 驗證 */
  process.env.MALWARE_SCAN_ACK_DISABLED = "1"
  process.env.BETTER_AUTH_SECRET = "y".repeat(48)
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
  const { configureApp } = await import("../src/app-setup.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await configureApp(app) // 掛 /api/auth/* handler + 安全標頭(與 main.ts 同構)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  auth = app.get<Auth>(AUTH)
  const { runMigrations: runAuthMigrations } = await getMigrations(auth.options)
  await runAuthMigrations()
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
  Object.assign(process.env, savedEnv)
})

describe("Better Auth HTTP handler 掛載 + 硬化(F-2 M4/M5)", () => {
  it("POST /api/auth/sign-up/email(HTTP handler)→ 200 + 設 session cookie + 安全標頭", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "m4a@weyver.test", password: "s3cret-passw0rd", name: "M4 A" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers["set-cookie"]).toBeTruthy()
    // onSend 安全標頭(取代 helmet)全域生效,含 raw auth route
    expect(res.headers["x-frame-options"]).toBe("DENY")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
    expect(res.headers["strict-transport-security"]).toContain("max-age=")
  })

  it("HTTP 取得之 cookie 經 guard 認證:建 org → 設 active → GET /api/forms 200", async () => {
    const signUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "m4b@weyver.test", password: "s3cret-passw0rd", name: "M4 B" },
    })
    const cookie = cookieFromInject(signUp.headers["set-cookie"])
    expect(cookie).not.toBe("")

    const org = await auth.api.createOrganization({
      headers: new Headers({ cookie }),
      body: { name: "M4 廠", slug: "m4-chang" },
    })
    if (!org) throw new Error("createOrganization returned null")
    await auth.api.setActiveOrganization({
      headers: new Headers({ cookie }),
      body: { organizationId: org.id },
    })

    const forms = await app.inject({ method: "GET", url: "/api/forms", headers: { cookie } })
    expect(forms.statusCode).toBe(200)
  })

  it("登入暴力:重複錯誤密碼觸發 Better Auth rateLimit(429)", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        payload: { email: "ghost@weyver.test", password: "wrong-guess" },
      })
      statuses.push(res.statusCode)
    }
    expect(statuses).toContain(429)
  })
})
