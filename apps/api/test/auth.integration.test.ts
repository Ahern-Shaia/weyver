import { Global, Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { getMigrations } from "better-auth/db/migration"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Auth, createAuth } from "../src/auth/auth.js"
import { AuthModule } from "../src/auth/auth.module.js"
import { AUTH } from "../src/auth/auth.tokens.js"
import { BillingModule } from "../src/billing/billing.module.js"
import { validateEnv } from "../src/config/env.js"
import { APP_DRIZZLE, DRIZZLE, PG_POOL, TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations as runWeyverMigrations } from "../src/db/migrate.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let auth: Auth

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri(), 8)
  auth = createAuth(pool, "test-secret-0123456789")
  // Better Auth 自建其 schema(user/account/session/organization/member/invitation…)
  /* 🔴 **我們自己的 migration 也要跑**。認證的 before/after hook 會查
     `auth_audit`(逐帳號節流)與 `initial_credential`(初始密碼生命週期);
     只跑 Better Auth 的 schema 等於在一個與 production 不一致的 DB 上測登入
     —— 實測會直接 `relation "auth_audit" does not exist`。 */
  await runWeyverMigrations(pool)
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
        // F-6 M3:AuthzRepository 需 TenantDb(app 車道);測試同 pool 即可
        { provide: APP_DRIZZLE, useFactory: () => createDrizzle(pool) },
        TenantDb,
      ],
      exports: [PG_POOL, DRIZZLE, APP_DRIZZLE, TenantDb],
    })
    class FakePgModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnv }),
        FakePgModule,
        /* F-8:TenantGuard 注入 EntitlementService(@Global 但測試模組圖需顯式帶入)*/
        BillingModule,
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

/* 🔴 成員數上限不得由套件預設值代管。

   Better Auth 的 `membershipLimit` 預設 **100**(`plugins/organization/adapter.mjs`
   逐字:`options?.membershipLimit ?? 100`)。未明設的話,**超過 100 人的租戶
   就再也加不了成員** —— 而首波 pilot 是食品加工廠,百人以上完全正常。

   這條紅燈原本是以「建立成員時出現 internal error」的形式出現在 e2e 上,
   查了伺服器 log 才看到真正的 `Organization membership limit reached`。 */
describe("🔴 組織成員上限", () => {
  it("🔴 明設 membershipLimit,不吃套件預設的 100", () => {
    const opts = auth.options as { plugins?: { id?: string; options?: unknown }[] }
    const org = opts.plugins?.find((p) => p.id === "organization")
    const limit = (org?.options as { membershipLimit?: number } | undefined)?.membershipLimit
    expect(limit).toBeDefined()
    expect(limit).toBeGreaterThan(100)
  })
})
