import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { getMigrations } from "better-auth/db/migration"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAuth } from "../src/auth/auth.js"
import {
  LOCKOUT_MAX_SECONDS,
  MAX_CONSECUTIVE_FAILURES,
  lockoutSeconds,
} from "../src/auth/login-throttle.js"
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

/* 直接打 handler(而非 `auth.api.*`)—— 偽造發生在 HTTP header 這一層。

   ⚠️ **兩個機制會互相干擾**,所以測哪一個就要把另一個排除:
   · 測 **IP 分桶**時每次換一個不存在的帳號 → 帳號節流永遠不會觸發
     (查無此帳號 → 連續失敗數為 0),429 只可能來自 IP 這一側。
   · 測 **帳號節流**時每次換一個 peer → IP 限流永遠不會觸發。
   混在一起測的話,測試會因為「另一個機制先擋下」而通過,看起來綠、其實沒測到。 */
async function attempt(headers: Record<string, string>, email = EMAIL): Promise<number> {
  const res = await auth.handler(
    new Request("http://localhost:3001/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        ...headers,
      },
      body: JSON.stringify({ email, password: "wrong-password-here" }),
    }),
  )
  return res.status
}

describe("🔴 登入限流不得被 x-forwarded-for 繞過", () => {
  it("🔴 每次換一個假 x-forwarded-for,仍必須被擋下", async () => {
    const codes: number[] = []
    for (let i = 0; i < 40; i += 1) {
      codes.push(
        await attempt(
          { "x-forwarded-for": `203.0.113.${String(i + 1)}` },
          `ip-${String(i)}@x.test`,
        ),
      )
    }
    /* 修正前:每個偽造 IP 各自一個桶 → 40 次全是 401,等於沒有上限。
       修正後:全部落在同一個真實 peer 的桶 → 超過額度即 429。 */
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
  })

  /* 🔴 反向檢查:上一條也可能是因為「全部擠進同一個桶」而通過 ——
     那會比原本更糟(一個攻擊者就能把全體使用者鎖在門外)。
     這一條確認分桶**確實依 peer header**:A 被鎖時 B 仍能嘗試。 */
  it("🔴 不同 peer 各自分桶 —— 一個來源被鎖不得波及其他人", async () => {
    const a: number[] = []
    for (let i = 0; i < 25; i += 1) {
      a.push(await attempt({ "x-weyver-peer-ip": "198.51.100.10" }, `bucket-${String(i)}@x.test`))
    }
    expect(a.filter((c) => c === 429).length).toBeGreaterThan(0)

    const bRes = await auth.handler(
      new Request("http://localhost:3001/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-weyver-peer-ip": "198.51.100.99",
        },
        body: JSON.stringify({ email: "bucket-b@x.test", password: "wrong-password-here" }),
      }),
    )
    expect(bRes.status).not.toBe(429)
  })
})

/* 🔴 63B-4 §3.2.2 要求的是**逐帳號**的連續失敗上限,不是逐 IP ——
   憑證填充天生分散在大量 IP,per-IP 上限對它無效;而 per-IP 上限反過來
   會誤傷共用出口 IP 的整間辦公室。 */
describe("🔴 逐帳號節流(63B-4 §3.2.2)", () => {
  it("🔴 同一帳號連續失敗到上限即暫時鎖定 —— **即使每次都換 IP**", async () => {
    const codes: number[] = []
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES + 3; i += 1) {
      codes.push(await attempt({ "x-weyver-peer-ip": `192.0.2.${String(i + 1)}` }, EMAIL))
    }
    /* 每次一個全新的 peer → per-IP 限流完全不會觸發;
       擋下來的必定是帳號這一側。 */
    expect(codes.slice(-1)[0]).toBe(429)
  })

  it("🔴 別的帳號不受影響 —— 否則亂打就能把任何人鎖死(阻斷服務)", async () => {
    const other = await auth.handler(
      new Request("http://localhost:3001/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-weyver-peer-ip": "192.0.2.250",
        },
        body: JSON.stringify({ email: "someone-else@weyver.test", password: "whatever-1234" }),
      }),
    )
    expect(other.status).not.toBe(429)
  })
})

/* 🔴 鎖定時間**指數遞增**。OWASP Authentication Cheat Sheet 明文點名固定時長
   會被反過來用:「care must be taken to prevent it from being used to cause a
   denial of service by locking out other users' accounts.」
   它給的替代做法即為「exponential lockout… starts as a very short period
   (e.g., one second), but doubles」。 */
describe("🔴 指數退避(避免鎖定本身變成 DoS 工具)", () => {
  it("🔴 未達門檻不鎖", () => {
    expect(lockoutSeconds(MAX_CONSECUTIVE_FAILURES - 1)).toBe(0)
  })

  it("🔴 剛達門檻只鎖 1 秒 —— 隨手騷擾對受害者幾乎無感", () => {
    expect(lockoutSeconds(MAX_CONSECUTIVE_FAILURES)).toBe(1)
  })

  it("持續失敗即倍增,壓垮嘗試速率", () => {
    expect(lockoutSeconds(MAX_CONSECUTIVE_FAILURES + 1)).toBe(2)
    expect(lockoutSeconds(MAX_CONSECUTIVE_FAILURES + 4)).toBe(16)
  })

  it("🔴 有上限,不會無限增長成事實上的永久封鎖", () => {
    expect(lockoutSeconds(MAX_CONSECUTIVE_FAILURES + 100)).toBe(LOCKOUT_MAX_SECONDS)
  })
})
