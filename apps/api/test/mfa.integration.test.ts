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
  /* 🔴 啟用流程本身會 verifyTotp 一次 → 該 time step 已被「用掉」。
     實務後果:使用者啟用 2FA 後**於同一 30 秒窗內**登入會被重放防護擋下
     (同一 step 的碼相同,RFC 6238 §5.2 要求拒絕),需等下一組碼。
     測試不等 30 秒,改為清掉守衛列以模擬「已進入下一個時間窗」。 */
  await pool.query("DELETE FROM totp_replay_guard")
  return { secret, backupCodes: enabled.backupCodes }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  auth = createAuth(pool, "test-secret-0123456789abcdef")
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
  /* Weyver 自有的 drizzle migration —— TOTP 重放防護表(#111)不屬 better-auth schema */
  const { runMigrations: runWeyverMigrations } = await import("../src/db/migrate.js")
  await runWeyverMigrations(pool)
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

describe("🔴 備用碼單向雜湊(追溯稽核 #111)", () => {
  it("**DB 內不得存有明文備用碼** —— 原本是可逆加密", async () => {
    const { backupCodes } = await enroll("hash1@weyver.test")
    expect(backupCodes.length).toBe(10)

    const row = await pool.query<{ backup_codes: string }>(
      `SELECT "backupCodes" AS backup_codes FROM "twoFactor" ORDER BY id DESC LIMIT 1`,
    )
    const stored = row.rows[0]?.backup_codes ?? ""
    expect(stored).not.toBe("")

    /* 關鍵斷言:任何一組明文碼都不得出現在儲存值裡 */
    for (const code of backupCodes) {
      expect(stored).not.toContain(code)
      expect(stored).not.toContain(code.replaceAll("-", ""))
    }
    /* 且應為我們的雜湊格式 */
    expect(stored).toContain("bc1$")
  })

  it("**碼長 ≥112 bits** —— 這是能用 HMAC 而非 Argon2id 的前提(NIST SP 800-63B)", async () => {
    const { backupCodes } = await enroll("hash2@weyver.test")
    for (const code of backupCodes) {
      const chars = code.replaceAll("-", "")
      expect(chars.length).toBe(24)
      /* 24 × log2(32) = 120 bits */
      expect(chars.length * 5).toBeGreaterThanOrEqual(112)
      expect(chars).toMatch(/^[A-Z2-7]+$/)
    }
  })

  it("雜湊後仍可正常用備用碼登入(hook 把使用者輸入也雜湊)", async () => {
    const email = "hash3@weyver.test"
    const { backupCodes } = await enroll(email)
    const first = backupCodes[0]
    expect(first).toBeDefined()

    const signIn = await auth.api.signInEmail({
      body: { email, password: "s3cret-passw0rd" },
      returnHeaders: true,
    })
    const cookie = cookieFrom(signIn.headers)
    const res = await auth.api.verifyBackupCode({
      headers: new Headers({ cookie }),
      body: { code: first as string },
    })
    expect(res.user.email).toBe(email)
  })

  it("**用過的備用碼不可重用**(一次性)", async () => {
    const email = "hash4@weyver.test"
    const { backupCodes } = await enroll(email)
    const code = backupCodes[0] as string

    for (const attempt of [1, 2]) {
      const signIn = await auth.api.signInEmail({
        body: { email, password: "s3cret-passw0rd" },
        returnHeaders: true,
      })
      const cookie = cookieFrom(signIn.headers)
      const call = auth.api.verifyBackupCode({
        headers: new Headers({ cookie }),
        body: { code },
      })
      if (attempt === 1) await expect(call).resolves.toBeTruthy()
      else await expect(call).rejects.toThrow()
    }
  })
})

describe("🔴 TOTP 重放防護(RFC 6238 §5.2,追溯稽核 #111)", () => {
  it("**同一組碼不得用第二次** —— 原本 90 秒窗內可重複使用", async () => {
    const email = "replay@weyver.test"
    const { secret } = await enroll(email)

    const loginWith = async (): Promise<string> => {
      const signIn = await auth.api.signInEmail({
        body: { email, password: "s3cret-passw0rd" },
        returnHeaders: true,
      })
      return cookieFrom(signIn.headers)
    }

    const code = authenticator.generate(secret)

    const first = await auth.api.verifyTOTP({
      headers: new Headers({ cookie: await loginWith() }),
      body: { code },
    })
    expect(first.user.email).toBe(email)

    /* 同一組碼再用一次 —— RFC 6238 §5.2 明訂 MUST NOT accept */
    await expect(
      auth.api.verifyTOTP({
        headers: new Headers({ cookie: await loginWith() }),
        body: { code },
      }),
    ).rejects.toThrow()
  })
})
