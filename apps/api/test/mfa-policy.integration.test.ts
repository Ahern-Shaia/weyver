import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { getMigrations } from "better-auth/db/migration"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createAuth } from "../src/auth/auth.js"
import { hasMfaEnabled, tenantRequiresMfa } from "../src/auth/mfa-gate.js"
import { countTrustedDevicesFor, revokeTrustedDevicesFor } from "../src/auth/trusted-device.js"
import { runMigrations } from "../src/db/migrate.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

/* 🔴 #112|租戶強制 2FA + 信任裝置。

   兩者都只在「有真實 session 的那條路」上發生,最容易變成**沒有人驗證過的程式碼**。
   本檔對真 PG + 真 Better Auth 釘住三件事:

   1. `twoFactorEnabled` 這個旗標我們讀得對(閘門整個建在它上面)
   2. 租戶開關讀得對
   3. 🔴 **信任裝置的撤銷** —— Better Auth 的 `/two-factor/disable` 只撤當下這一台,
      「停用再啟用」會讓其他舊裝置繼續免驗。這是我方補的那一刀。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let auth: ReturnType<typeof createAuth>

const PW = "Rk7-vLm2-Qz9x-Tp4"

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri())
  await runMigrations(pool)
  auth = createAuth(pool, "test-secret-0123456789abcdef")
  const m = await getMigrations(auth.options)
  await m.runMigrations()
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

const signUp = async (email: string): Promise<string> => {
  await auth.api.signUpEmail({ body: { email, name: "同事", password: PW } })
  const u = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])
  return u.rows[0]?.id ?? ""
}

/* 直接寫入信任記錄:形狀取自 plugin 原始碼(identifier 前綴 + value = user id)。
   走真實登入流程才能拿到的 cookie 在這裡沒有意義 —— 要驗的是**撤銷**那一半。 */
const seedTrustedDevice = async (authUserId: string, tag: string): Promise<void> => {
  await pool.query(
    `INSERT INTO "verification" (id, identifier, value, "expiresAt")
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [`v-${tag}`, `trust-device-${tag}`, authUserId],
  )
}

describe("🔴 租戶強制 2FA 的判斷來源", () => {
  it("預設不強制 —— 既有租戶零行為變化", async () => {
    const t = await pool.query<{ id: number }>(
      `INSERT INTO tenants (name) VALUES ('甲') RETURNING id`,
    )
    expect(await tenantRequiresMfa(pool, t.rows[0]?.id ?? 0)).toBe(false)
  })

  it("開啟後讀得到", async () => {
    const t = await pool.query<{ id: number }>(
      `INSERT INTO tenants (name) VALUES ('乙') RETURNING id`,
    )
    const id = t.rows[0]?.id ?? 0
    await pool.query("UPDATE tenants SET require_mfa = true WHERE id = $1", [id])
    expect(await tenantRequiresMfa(pool, id)).toBe(true)
  })

  it("🔴 未啟用 2FA 的人一律回 false —— 閘門的整個判斷建在這個旗標上", async () => {
    const userId = await signUp("nomfa@weyver.test")
    expect(await hasMfaEnabled(pool, userId)).toBe(false)
    /* 不存在的使用者也不得誤判為已啟用(fail-closed 的反面同樣要對) */
    expect(await hasMfaEnabled(pool, "no-such-user")).toBe(false)
  })

  it("啟用旗標為 true 時讀得到", async () => {
    const userId = await signUp("hasmfa@weyver.test")
    await pool.query(`UPDATE "user" SET "twoFactorEnabled" = true WHERE id = $1`, [userId])
    expect(await hasMfaEnabled(pool, userId)).toBe(true)
  })
})

describe("🔴 信任裝置的撤銷(Better Auth 只做了一半)", () => {
  it("🔴 撤銷會清掉該使用者的**全部**信任裝置", async () => {
    const userId = await signUp("trust@weyver.test")
    await seedTrustedDevice(userId, "laptop")
    await seedTrustedDevice(userId, "phone")
    expect(await countTrustedDevicesFor(pool, userId)).toBe(2)

    expect(await revokeTrustedDevicesFor(pool, userId)).toBe(2)
    expect(await countTrustedDevicesFor(pool, userId)).toBe(0)
  })

  it("🔴 不得波及別人的信任裝置", async () => {
    const mine = await signUp("mine@weyver.test")
    const theirs = await signUp("theirs@weyver.test")
    await seedTrustedDevice(mine, "mine-1")
    await seedTrustedDevice(theirs, "theirs-1")

    await revokeTrustedDevicesFor(pool, mine)
    expect(await countTrustedDevicesFor(pool, theirs)).toBe(1)
  })

  /* 過期的記錄不該被算成「還有一台信任裝置」—— 那會讓畫面上的數字騙人 */
  it("過期的信任裝置不計入", async () => {
    const userId = await signUp("expired@weyver.test")
    await pool.query(
      `INSERT INTO "verification" (id, identifier, value, "expiresAt")
       VALUES ('v-old', 'trust-device-old', $1, now() - interval '1 day')`,
      [userId],
    )
    expect(await countTrustedDevicesFor(pool, userId)).toBe(0)
  })
})
