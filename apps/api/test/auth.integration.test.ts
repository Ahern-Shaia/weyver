import { Global, Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import { getMigrations } from "better-auth/db/migration"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AUTH, AuthModule } from "../src/auth/auth.module.js"
import { type Auth, createAuth } from "../src/auth/auth.js"
import { validateEnv } from "../src/config/env.js"
import { DRIZZLE, PG_POOL, createDrizzle } from "../src/db/db.module.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let auth: Auth

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  auth = createAuth(pool, "test-secret-0123456789")
  // Better Auth 自建其 schema(user/account/session/organization/member/invitation…)
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("Better Auth 接入(F-2 M1)", () => {
  it("auth 表由 Better Auth migration 建立(含 organization plugin)", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    )
    const names = new Set(rows.map((r) => r.table_name))
    for (const t of ["user", "account", "session", "organization", "member"]) {
      expect(names.has(t)).toBe(true)
    }
  })

  it("註冊 → 建 user + 密碼以 Argon2id 儲存(非明文 / 非 scrypt)", async () => {
    await auth.api.signUpEmail({
      body: { email: "a@weyver.test", password: "s3cret-passw0rd", name: "廠 A 管理員" },
    })
    const users = await pool.query("SELECT id, email FROM \"user\" WHERE email='a@weyver.test'")
    expect(users.rows.length).toBe(1)
    const accounts = await pool.query<{ password: string }>(
      "SELECT password FROM account WHERE password IS NOT NULL",
    )
    expect(accounts.rows[0]?.password.startsWith("$argon2id$")).toBe(true)
  })

  it("登入:正確密碼成功、錯誤密碼失敗", async () => {
    const ok = await auth.api.signInEmail({
      body: { email: "a@weyver.test", password: "s3cret-passw0rd" },
    })
    expect(ok.user.email).toBe("a@weyver.test")

    await expect(
      auth.api.signInEmail({ body: { email: "a@weyver.test", password: "wrong" } }),
    ).rejects.toThrow()
  })

  it("帳號列舉防護:未知帳號登入不洩漏「帳號不存在」", async () => {
    await expect(
      auth.api.signInEmail({ body: { email: "ghost@weyver.test", password: "whatever" } }),
    ).rejects.toThrow()
  })

  it("NestJS DI:AUTH token 由 AuthModule 解析出可用引擎(接 config secret + 真實 pool)", async () => {
    @Global()
    @Module({
      providers: [
        { provide: PG_POOL, useValue: pool },
        { provide: DRIZZLE, useFactory: () => createDrizzle(pool) },
      ],
      exports: [PG_POOL, DRIZZLE],
    })
    class FakePgModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnv }),
        FakePgModule,
        AuthModule,
      ],
    }).compile()

    const wired = moduleRef.get<Auth>(AUTH)
    // DI 提供的實例即真實 Better Auth:登入先前註冊之帳號成功(證 secret + pool 皆正確接入)
    const ok = await wired.api.signInEmail({
      body: { email: "a@weyver.test", password: "s3cret-passw0rd" },
    })
    expect(ok.user.email).toBe("a@weyver.test")
    await moduleRef.close()
  })
})
