import { getMigrations } from "better-auth/db/migration"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAuth } from "../src/auth/auth.js"
import { runMigrations } from "../src/db/migrate.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 登入暴力防護的**分桶依據**必須是不可偽造的來源。

   Better Auth 以 `getIp()` 決定 rate limit 的 key,而 1.6.23 的
   `@better-auth/core/dist/utils/ip.mjs` 逐字為:

     const DEFAULT_IP_HEADERS = ["x-forwarded-for"]
     …
     if (trustedProxies.length > 0) { …走 proxy 鏈… }
     if (forwardedIps.length !== 1) return null
     return normalizeIP(selectedIp, …)      ← 單一值就**照收**

   也就是說:未設 `trustedProxies` 時,client 自己送的 `x-forwarded-for`
   會被當成真實 IP。而我們的 `/sign-in/email` 限流是 5 次/分 —— 攻擊者每次換一個
   假 IP,就得到無限次嘗試。同一個值也會被寫進 session 的 `ipAddress` 欄,
   讓「登入中的裝置」顯示攻擊者填的內容。

   修法:把 `ipAddressHeaders` 指向 `mountAuthHandler` 以 Fastify socket peer
   **覆寫**過的 `x-weyver-peer-ip`(見 auth-events.ts)。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let auth: ReturnType<typeof createAuth>

const EMAIL = "brute@weyver.test"

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  await runMigrations(pool)
  auth = createAuth(pool, "test-secret-0123456789abcdef")
  const baMigrations = await getMigrations(auth.options)
  await baMigrations.runMigrations()
  await auth.api.signUpEmail({
    body: { email: EMAIL, name: "受害者", password: "s3cret-passw0rd" },
  })
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

/* 直接打 handler(而非 `auth.api.*`)—— 偽造發生在 HTTP header 這一層 */
async function attempt(headers: Record<string, string>): Promise<number> {
  const res = await auth.handler(
    new Request("http://localhost:3001/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        ...headers,
      },
      body: JSON.stringify({ email: EMAIL, password: "wrong-password-here" }),
    }),
  )
  return res.status
}

describe("🔴 登入限流不得被 x-forwarded-for 繞過", () => {
  it("🔴 每次換一個假 x-forwarded-for,仍必須被擋下", async () => {
    const codes: number[] = []
    for (let i = 0; i < 12; i += 1) {
      codes.push(await attempt({ "x-forwarded-for": `203.0.113.${String(i + 1)}` }))
    }
    /* 修正前:12 次全是 401(限流被逐 IP 分桶,等於沒有上限)。
       修正後:超過 5 次/分即 429。 */
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
  })

  /* 🔴 反向檢查:上一條也可能是因為「全部擠進同一個桶」而通過 ——
     那會比原本更糟(一個攻擊者就能把全體使用者鎖在門外)。
     這一條確認分桶**確實依 peer header**:A 被鎖時 B 仍能嘗試。 */
  it("🔴 不同 peer 各自分桶 —— 一個來源被鎖不得波及其他人", async () => {
    const a: number[] = []
    for (let i = 0; i < 8; i += 1) a.push(await attempt({ "x-weyver-peer-ip": "198.51.100.10" }))
    expect(a.filter((c) => c === 429).length).toBeGreaterThan(0)

    const b = await attempt({ "x-weyver-peer-ip": "198.51.100.99" })
    expect(b).not.toBe(429)
  })
})
