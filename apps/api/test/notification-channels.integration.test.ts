import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { ConfigService } from "@nestjs/config"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { ChannelConfigService } from "../src/notifications/channel-config.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·A-1 M4|通道連接設定。本檔釘住的都是**出事才會發現**的性質:
   憑證不進回應、DB 裡不是明文、跨租戶讀不到、以及「未填 = 不動」。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let appPool: pg.Pool
let service: ChannelConfigService
let tenantA = 0
let tenantB = 0
let actorA = 0

const KEK = "test-kek-material-0123456789abcdefgh"
/* host 必須是 hooks.slack.com(allow-list 要認),但路徑刻意不排成真 webhook 的形狀
   —— 排成 `T…/B…/24 字` 會被 GitHub 的密鑰掃描判為真憑證而擋下推送。 */
const WEBHOOK = "https://hooks.slack.com/services/EXAMPLE-NOT-A-REAL-WEBHOOK"

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  await runMigrations(pool)
  const db = createDrizzle(pool)

  const t = await db
    .insert(tenants)
    .values([{ name: "甲廠" }, { name: "乙廠" }])
    .returning()
  tenantA = t[0]?.id ?? 0
  tenantB = t[1]?.id ?? 0
  const u = await db
    .insert(users)
    .values([{ authUserId: "ch-admin", email: "admin@weyver.test", name: "管理員" }])
    .returning()
  actorA = u[0]?.id ?? 0

  /* 🔴 走 **app 車道**(NOSUPERUSER / NOBYPASSRLS)—— 用特權連線測 RLS 等於沒測。
     本專案已經因為這件事踩過七次。 */
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  appPool = new pg.Pool({ connectionString: appUri.toString() })

  const config = {
    get: (key: string) => (key === "WEYVER_SECRET_KEK" ? KEK : undefined),
  } as unknown as ConfigService
  service = new ChannelConfigService(new TenantDb(createDrizzle(appPool)), config)
}, 180_000)

afterAll(async () => {
  await appPool?.end()
  await pool?.end()
  await container?.stop()
})

describe("🔴 憑證的儲存與回顯", () => {
  it("存得進去,狀態顯示為已設定", async () => {
    const status = await service.save(tenantA, actorA, {
      channel: "slack",
      config: {},
      secret: WEBHOOK,
      enabled: true,
    })
    expect(status.secretSet).toBe(true)
    expect(status.enabled).toBe(true)
  })

  /* 🔴 Grafana `secureJsonFields` 語意:API 只回布林旗標,**永不回值**。
     用 JSON 全文比對,才擋得住日後有人在 DTO 加一個「方便除錯」的欄位。 */
  it("🔴 回應裡任何地方都不得出現憑證明文", async () => {
    const all = await service.list(tenantA)
    expect(JSON.stringify(all)).not.toContain(WEBHOOK)
    expect(JSON.stringify(all)).not.toContain("abcdefghijklmnopqrstuvwx")
  })

  it("🔴 DB 裡存的不是明文", async () => {
    const row = await pool.query<{ secret_sealed: string }>(
      `SELECT secret_sealed FROM notification_channel WHERE tenant_id = $1 AND channel = 'slack'`,
      [tenantA],
    )
    const sealed = row.rows[0]?.secret_sealed ?? ""
    expect(sealed).not.toContain(WEBHOOK)
    expect(sealed).not.toContain("hooks.slack.com")
    expect(sealed.startsWith("v1.")).toBe(true)
  })

  it("發送路徑取得回明文", async () => {
    expect(await service.revealSecret(tenantA, "slack")).toBe(WEBHOOK)
  })
})

describe("🔴 未填 = 不動", () => {
  /* 寫反的話,使用者每次調設定都會把憑證洗掉,而且要等到下次發送失敗才知道。 */
  it("🔴 只改設定、不送 secret → 憑證保留", async () => {
    await service.save(tenantA, actorA, { channel: "slack", config: { note: "營運群組" } })
    expect(await service.revealSecret(tenantA, "slack")).toBe(WEBHOOK)
    const status = (await service.list(tenantA)).find((s) => s.channel === "slack")
    expect(status?.config).toEqual({ note: "營運群組" })
  })

  it("顯式 clearSecret 才會清除", async () => {
    await service.save(tenantA, actorA, {
      channel: "teams",
      config: {},
      secret: "https://outlook.office.com/webhook/abc",
    })
    expect(await service.revealSecret(tenantA, "teams")).not.toBeNull()
    await service.save(tenantA, actorA, { channel: "teams", config: {}, clearSecret: true })
    expect(await service.revealSecret(tenantA, "teams")).toBeNull()
  })
})

describe("🔴 換憑證必須重新驗證", () => {
  it("🔴 verifiedAt 於憑證變更時歸零 —— 舊的驗證不能替新值背書", async () => {
    await service.save(tenantA, actorA, {
      channel: "discord",
      config: {},
      secret: "https://discord.com/api/webhooks/1/aaa",
    })
    await service.markVerified(tenantA, "discord")
    expect(
      (await service.list(tenantA)).find((s) => s.channel === "discord")?.verifiedAt,
    ).not.toBeNull()

    await service.save(tenantA, actorA, {
      channel: "discord",
      config: {},
      secret: "https://discord.com/api/webhooks/1/bbb",
    })
    expect(
      (await service.list(tenantA)).find((s) => s.channel === "discord")?.verifiedAt,
    ).toBeNull()
  })
})

describe("🔴 allow-list 在儲存當下就擋", () => {
  /* 等到發送時才檢查的話,一個指向內網的 URL 已經先躺在 DB 裡,
     任何未來新增的發送路徑都可能漏掉那道檢查。 */
  it("🔴 非官方網域的 webhook 存不進去", async () => {
    await expect(
      service.save(tenantA, actorA, {
        channel: "slack",
        config: {},
        secret: "https://evil.example/hook",
      }),
    ).rejects.toThrow()
    await expect(
      service.save(tenantA, actorA, {
        channel: "slack",
        config: {},
        secret: "http://169.254.169.254/latest/",
      }),
    ).rejects.toThrow()
  })
})

describe("🔴 跨租戶隔離", () => {
  it("🔴 乙廠讀不到甲廠的通道設定", async () => {
    const b = await service.list(tenantB)
    expect(b.every((s) => !s.secretSet)).toBe(true)
    expect(await service.revealSecret(tenantB, "slack")).toBeNull()
  })

  /* 🔴 RLS 兜底:即使查詢忘了帶 tenant 條件,也不該看到別人的列。 */
  it("🔴 無 WHERE 的查詢在 app 車道也只看得到自己租戶", async () => {
    const client = await appPool.connect()
    try {
      await client.query("BEGIN")
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantB)])
      const r = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM notification_channel",
      )
      expect(r.rows[0]?.n).toBe(0)
      await client.query("COMMIT")
    } finally {
      client.release()
    }
  })
})
