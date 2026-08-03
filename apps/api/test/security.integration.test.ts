import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { getMigrations } from "better-auth/db/migration"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAuth } from "../src/auth/auth.js"
import { type DrizzleDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import {
  AUTH_AUDIT_RETENTION_DAYS,
  SecurityService,
  describeUserAgent,
} from "../src/security/security.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·A-1 M3|帳號安全。本檔釘住三條由研究直接推導的性質:

   1. **強制登出必須連帶撤 API 金鑰** —— Google 官方自陳登出不完全
      (「signed out everywhere **except**…」),只殺 session 而留著長期憑證
      等於門鎖了窗還開著。
   2. **目前這台要標出來** —— 否則使用者不敢按,怕把自己踢掉。
   3. **稽核保留 6 個月**(台灣資安分級辦法附表十),且 app 車道只讀不寫 ——
      一般請求路徑造不出假紀錄、也刪不掉。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let appPool: pg.Pool
let db: DrizzleDb
let security: SecurityService
let tenantA = 0
let auth: ReturnType<typeof createAuth>
const AUTH_ID = "auth-sec-user"

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  await runMigrations(pool)
  /* Better Auth 自管 schema(user / session / account / organization / member)
     由它自己的 migration 建立,不在我們的 drizzle migration 裡 —— 承 mfa 測試同法。 */
  auth = createAuth(pool, "test-secret-0123456789abcdef")
  const baMigrations = await getMigrations(auth.options)
  await baMigrations.runMigrations()
  db = createDrizzle(pool)

  const t = await db
    .insert(tenants)
    .values([{ name: "安全廠" }])
    .returning()
  tenantA = t[0]?.id ?? 0
  const u = await db
    .insert(users)
    .values([{ authUserId: AUTH_ID, email: "sec@weyver.test", name: "安全員" }])
    .returning()
  const actorId = u[0]?.id ?? 0

  /* Better Auth 的表由它自己的 migration 建;此處只要 session / api_key 存在即可 */
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, '安全員', 'sec@weyver.test', true, now(), now()) ON CONFLICT DO NOTHING`,
    [AUTH_ID],
  )
  for (const [id, token] of [
    ["s-current", "tok-current"],
    ["s-old-1", "tok-old-1"],
    ["s-old-2", "tok-old-2"],
  ]) {
    await pool.query(
      `INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId")
       VALUES ($1, now() + interval '7 days', $2, now(), now(), '203.0.113.7',
               'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', $3)`,
      [id, token, AUTH_ID],
    )
  }
  await pool.query(
    `INSERT INTO api_key (tenant_id, name, key_hash, key_prefix, subject_actor_id, created_by)
     VALUES ($1, 'k1', 'h1', 'wvk_a', $2, $2), ($1, 'k2', 'h2', 'wvk_b', $2, $2)`,
    [tenantA, actorId],
  )

  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  appPool = new pg.Pool({ connectionString: appUri.toString() })

  security = new SecurityService(db)
}, 180_000)

afterAll(async () => {
  await appPool?.end()
  await pool?.end()
  await container?.stop()
})

describe("裝置(session)清單", () => {
  it("列出未過期的 session,含 IP 與 UA", async () => {
    const rows = await security.listSessions(AUTH_ID, "tok-current")
    expect(rows).toHaveLength(3)
    expect(rows[0]?.ipAddress).toBe("203.0.113.7")
    expect(rows[0]?.userAgent).toContain("Chrome")
  })

  it("🔴 標出「目前這台」—— 否則使用者不敢按登出,怕把自己踢掉", async () => {
    const rows = await security.listSessions(AUTH_ID, "tok-current")
    expect(rows.filter((r) => r.current)).toHaveLength(1)
  })

  it("UA 轉可讀敘述(只是給人看的線索,不是判斷依據)", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome · macOS")
    expect(describeUserAgent(null)).toBe("未知裝置")
  })
})

describe("🔴 強制登出", () => {
  it("🔴 登出其他裝置時**一併撤銷 API 金鑰** —— 只殺 session 等於門鎖了窗還開著", async () => {
    const r = await security.revokeOtherSessions(AUTH_ID, "tok-current")
    expect(r.sessions).toBe(2)
    expect(r.apiKeys).toBe(2) // 兩把都撤

    const left = await security.listSessions(AUTH_ID, "tok-current")
    expect(left).toHaveLength(1)
    expect(left[0]?.current).toBe(true)

    const keys = await pool.query("SELECT count(*)::int AS n FROM api_key WHERE revoked_at IS NULL")
    expect(keys.rows[0].n).toBe(0)
  })
})

describe("認證稽核", () => {
  it("記錄事件並可查回", async () => {
    await security.record({
      event: "login.success",
      authUserId: AUTH_ID,
      tenantId: tenantA,
      ipAddress: "203.0.113.7",
      userAgent: "Chrome",
    })
    await security.record({ event: "login.failure", ipAddress: "198.51.100.9" })

    const rows = await security.listAudit(AUTH_ID)
    expect(rows.some((r) => r.event === "login.success")).toBe(true)
  })

  /* 🔴 登入失敗時可能連帳號都不知道 —— 那正是最需要記錄的事件之一。
     若欄位設成 NOT NULL,它會被排除在稽核之外。 */
  it("🔴 登入失敗可在**沒有 authUserId / tenantId** 的情況下記錄", async () => {
    const r = await pool.query(
      "SELECT count(*)::int AS n FROM auth_audit WHERE event = 'login.failure' AND auth_user_id IS NULL",
    )
    expect(r.rows[0].n).toBeGreaterThan(0)
  })

  it("🔴 保留 6 個月(台灣資安分級辦法附表十),逾期才清", async () => {
    expect(AUTH_AUDIT_RETENTION_DAYS).toBe(183)
    await pool.query(
      `INSERT INTO auth_audit (event, auth_user_id, created_at)
       VALUES ('login.success', $1, now() - interval '200 days')`,
      [AUTH_ID],
    )
    const before = await security.listAudit(AUTH_ID, 200)
    const purged = await security.purgeExpiredAudit()
    expect(purged).toBeGreaterThan(0)
    const after = await security.listAudit(AUTH_ID, 200)
    expect(after.length).toBeLessThan(before.length)
  })

  it("🔴 未逾期的不得被清掉", async () => {
    const rows = await security.listAudit(AUTH_ID, 200)
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe("🔴 app 車道的權限邊界", () => {
  it("🔴 app 車道不得寫入稽核(避免偽造紀錄)", async () => {
    await expect(appPool.query("INSERT INTO auth_audit (event) VALUES ('forged')")).rejects.toThrow(
      /permission denied/,
    )
  })

  it("🔴 app 車道不得刪除稽核 —— 清理只能由保留期 job 執行", async () => {
    await expect(appPool.query("DELETE FROM auth_audit")).rejects.toThrow(/permission denied/)
  })
})

/* 🔴 認證事件是否**真的**被記下來 —— 前面那些測試只證明「寫得進去」,
   不證明 Better Auth 的 hook 有把事件送過來。這一組走真實登入流程。

   同時,它是 `ctx.context.returned` 的警報器:那個欄位**不在 better-auth 1.6.23
   的公開型別裡**(只在 runtime 由 dispatch 設定),升版若移除,
   「登入失敗要記得到」這條會轉紅。 */
describe("🔴 認證事件記錄(走真實登入流程)", () => {
  const email = "audit-flow@weyver.test"
  const password = "s3cret-passw0rd"

  const auditOf = async (ev: string, who: string | null) =>
    (
      await pool.query<{ n: number; detail: unknown }>(
        `SELECT count(*)::int AS n, min(detail::text) AS detail FROM auth_audit
          WHERE event = $1 AND auth_user_id IS NOT DISTINCT FROM $2`,
        [ev, who],
      )
    ).rows[0]

  it("登入成功 → 記 login.success", async () => {
    await auth.api.signUpEmail({ body: { email, name: "稽核流程", password } })
    const user = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])
    const uid = user.rows[0]?.id ?? ""
    expect(uid).not.toBe("")

    await auth.api.signInEmail({ body: { email, password } })
    expect((await auditOf("login.success", uid))?.n).toBeGreaterThan(0)
  })

  it("🔴 密碼錯誤 → 記 login.failure,而且**掛在被試的那個帳號上**", async () => {
    const user = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])
    const uid = user.rows[0]?.id ?? ""
    await auth.api
      .signInEmail({ body: { email, password: "definitely-wrong-pw" } })
      .catch(() => null)

    /* 掛得到人,使用者才看得到「有人在試我的帳號」。掛不到人 = 這頁沒有意義。 */
    expect((await auditOf("login.failure", uid))?.n).toBeGreaterThan(0)
  })

  it("🔴 帳號不存在 → 仍記錄,但**不存對方輸入的 email**(攻擊者可控的自由文字)", async () => {
    await auth.api
      .signInEmail({ body: { email: "ghost@weyver.test", password: "definitely-wrong-pw" } })
      .catch(() => null)

    const row = await auditOf("login.failure", null)
    expect(row?.n).toBeGreaterThan(0)
    expect(String(row?.detail)).toContain("unknown_account")

    const leaked = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_audit WHERE detail::text LIKE '%ghost@weyver.test%'`,
    )
    expect(leaked.rows[0]?.n).toBe(0)
  })
})
