import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { getMigrations } from "better-auth/db/migration"
import { authenticator } from "otplib"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Auth, createAuth } from "../src/auth/auth.js"

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let auth: Auth

const PASSWORD = "s3cret-passw0rd"

function cookieFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ")
}

function secretFromUri(totpUri: string): string {
  const secret = new URL(totpUri).searchParams.get("secret")
  if (!secret) throw new Error(`totpURI has no secret: ${totpUri}`)
  return secret
}

/* 註冊 → 啟用 2FA(enable 回 URI+backup;verifyTotp 才真正啟用)→ 回登入所需素材。 */
async function enroll(
  email: string,
): Promise<{ secret: string; backupCodes: readonly string[] }> {
  const signUp = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: email },
    returnHeaders: true,
  })
  const cookie = cookieFrom(signUp.headers)
  const enabled = await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: new Headers({ cookie }),
  })
  const secret = secretFromUri(enabled.totpURI)
  await auth.api.verifyTOTP({
    body: { code: authenticator.generate(secret) },
    headers: new Headers({ cookie }),
  })
  return { secret, backupCodes: enabled.backupCodes }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  auth = createAuth(pool, "test-secret-0123456789abcdef")
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("MFA TOTP 二步驟驗證(F-4 M1)", () => {
  it("enable 回 totpURI + backup codes;twoFactor 表由 migration 建立", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='twoFactor'",
    )
    expect(rows.length).toBe(1)

    const { secret, backupCodes } = await enroll("mfa1@weyver.test")
    expect(secret.length).toBeGreaterThan(0)
    expect(backupCodes.length).toBeGreaterThan(0)
  })

  it("啟用後登入需二步:signIn 回 twoFactorRedirect(不發完整 session)→ verifyTotp 發 session", async () => {
    const { secret } = await enroll("mfa2@weyver.test")

    const signIn = await auth.api.signInEmail({
      body: { email: "mfa2@weyver.test", password: PASSWORD },
      returnHeaders: true,
    })
    expect((signIn.response as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true)

    // 帶 challenge cookie 驗 TOTP → 發完整 session
    const challengeCookie = cookieFrom(signIn.headers)
    const verified = await auth.api.verifyTOTP({
      body: { code: authenticator.generate(secret) },
      headers: new Headers({ cookie: challengeCookie }),
      returnHeaders: true,
    })
    const sessionCookie = cookieFrom(verified.headers)
    expect(sessionCookie).not.toBe("")

    const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) })
    expect(session?.user.email).toBe("mfa2@weyver.test")
  })

  it("錯誤 TOTP 碼 → 拒絕(不發 session)", async () => {
    await enroll("mfa3@weyver.test")
    const signIn = await auth.api.signInEmail({
      body: { email: "mfa3@weyver.test", password: PASSWORD },
      returnHeaders: true,
    })
    const challengeCookie = cookieFrom(signIn.headers)
    await expect(
      auth.api.verifyTOTP({
        body: { code: "000000" },
        headers: new Headers({ cookie: challengeCookie }),
      }),
    ).rejects.toThrow()
  })

  it("backup code 一次性:用過即失效", async () => {
    const { backupCodes } = await enroll("mfa4@weyver.test")
    const code = backupCodes[0]
    if (!code) throw new Error("no backup code")

    const first = await auth.api.signInEmail({
      body: { email: "mfa4@weyver.test", password: PASSWORD },
      returnHeaders: true,
    })
    const okVerify = await auth.api.verifyBackupCode({
      body: { code },
      headers: new Headers({ cookie: cookieFrom(first.headers) }),
      returnHeaders: true,
    })
    expect(cookieFrom(okVerify.headers)).not.toBe("")

    // 同一 backup code 再用 → 拒
    const second = await auth.api.signInEmail({
      body: { email: "mfa4@weyver.test", password: PASSWORD },
      returnHeaders: true,
    })
    await expect(
      auth.api.verifyBackupCode({
        body: { code },
        headers: new Headers({ cookie: cookieFrom(second.headers) }),
      }),
    ).rejects.toThrow()
  })
})
