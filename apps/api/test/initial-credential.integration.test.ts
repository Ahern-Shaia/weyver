import { getMigrations } from "better-auth/db/migration"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAuth } from "../src/auth/auth.js"
import { mustChangePassword } from "../src/auth/initial-credential.js"
import { runMigrations } from "../src/db/migrate.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 OQ-SC-16=A|初始密碼不得成為長期密碼(ASVS 5.0.0 §V6.4.1 逐字:
   「expire after a short period of time **or** after they are initially used」+
   「must not be permitted to become the long term password」)。

   M2 建了資料表卻沒有任何地方執法 —— `used_at` 從未被寫入、登入不查此表。
   本檔把三條性質釘住:過期擋登入 / 用過即須改 / 改完解除。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let auth: ReturnType<typeof createAuth>

const PW = "Rk7-vLm2-Qz9x-Tp4"

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  await runMigrations(pool)
  auth = createAuth(pool, "test-secret-0123456789abcdef")
  const m = await getMigrations(auth.options)
  await m.runMigrations()
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

async function newHire(email: string, expiresInHours: number): Promise<string> {
  await auth.api.signUpEmail({ body: { email, name: "新同事", password: PW } })
  const u = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])
  const authUserId = u.rows[0]?.id ?? ""
  /* 發放者是必填(誰發的憑證要留得下來)—— 借用同一列當發放者即可 */
  const actor = await pool.query<{ id: number }>(
    `INSERT INTO users (auth_user_id, email, name) VALUES ($1, $2, '發放者')
       ON CONFLICT (auth_user_id) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [authUserId, email],
  )
  const tenant = await pool.query<{ id: number }>(
    `INSERT INTO tenants (name) VALUES ('入職廠') RETURNING id`,
  )
  await pool.query(
    `INSERT INTO initial_credential (auth_user_id, expires_at, issued_by_actor_id, issued_in_tenant_id)
     VALUES ($1, now() + ($2 || ' hours')::interval, $3, $4)`,
    [authUserId, String(expiresInHours), actor.rows[0]?.id ?? 0, tenant.rows[0]?.id ?? 0],
  )
  return authUserId
}

describe("🔴 初始密碼的生命週期", () => {
  it("🔴 用過一次之後就必須自己改 —— 不得成為長期密碼", async () => {
    const id = await newHire("hire-a@weyver.test", 72)
    expect(await mustChangePassword(pool, id)).toBe(false) // 還沒用過

    await auth.api.signInEmail({ body: { email: "hire-a@weyver.test", password: PW } })

    const used = await pool.query<{ used_at: Date | null }>(
      `SELECT used_at FROM initial_credential WHERE auth_user_id = $1`,
      [id],
    )
    expect(used.rows[0]?.used_at).not.toBeNull()
    /* 這一條就是 M2 漏掉的東西:登入從不寫 used_at,於是這裡永遠是 false */
    expect(await mustChangePassword(pool, id)).toBe(true)
  })

  it("🔴 逾期的初始密碼**不能登入**,且剛發的 session 要被撤掉", async () => {
    const id = await newHire("hire-b@weyver.test", -1) // 已過期一小時
    /* 建帳號那一步(管理員代建)本身也會發一個沒有人持有的 session —— 先清掉,
       這條要驗的是「這次登入發出的 session 有沒有被撤回」。 */
    await pool.query(`DELETE FROM "session" WHERE "userId" = $1`, [id])

    await expect(
      auth.api.signInEmail({ body: { email: "hire-b@weyver.test", password: PW } }),
    ).rejects.toThrow()

    /* 密碼驗證是在 handler 裡成功的,session 已經發出去 → 必須撤回,
       否則「拒絕登入」只是訊息好看,cookie 還是能用。 */
    const left = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`,
      [id],
    )
    expect(left.rows[0]?.n).toBe(0)

    // 過期不算「用過」—— 管理員重發時不該看到一個已消耗的憑證
    const row = await pool.query<{ used_at: Date | null }>(
      `SELECT used_at FROM initial_credential WHERE auth_user_id = $1`,
      [id],
    )
    expect(row.rows[0]?.used_at).toBeNull()
  })

  it("🔴 自己改完密碼 → 憑證退場,閘門解除", async () => {
    const id = await newHire("hire-c@weyver.test", 72)
    const signIn = await auth.api.signInEmail({
      body: { email: "hire-c@weyver.test", password: PW },
      returnHeaders: true,
    })
    expect(await mustChangePassword(pool, id)).toBe(true)

    /* ⚠️ 必須用 **cookie** 認證。`authorization: Bearer` 在未啟用 bearer plugin 時
       會**靜默 401**,而這個呼叫形式不會拋 —— 測試看起來過了,改密碼卻從沒發生。
       (實測 hook context:cookie 認證下 `session.user.id` 有值,Bearer 下全為 null。) */
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ")
    await auth.api.changePassword({
      body: { currentPassword: PW, newPassword: "Xq8-mVt3-Bn6y-Ws2" },
      headers: { cookie },
    })

    expect(await mustChangePassword(pool, id)).toBe(false)
    const gone = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM initial_credential WHERE auth_user_id = $1`,
      [id],
    )
    /* 刪列而非加旗標 —— 成員頁既有的推導(無列 → 已設定)因此直接成立 */
    expect(gone.rows[0]?.n).toBe(0)
  })
})
