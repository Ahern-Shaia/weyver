import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { SettingsService } from "../src/settings/settings.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

/* 🔴 R1·A-1 M1|設定中心。本檔專攻三件事:

   1. **動態繼承的語意**(OQ-SC-3=A)—— 個人欄位 NULL = 繼承租戶值,
      改租戶預設會即時反映到未自訂者。這是本模組最容易寫反的一條。
   2. **`null` 與「沒送」必須分得開** —— 前者是「取消自訂回到繼承」,
      後者是「不要動」。混為一談會讓使用者永遠退不回繼承。
   3. **一律走 app 車道**(`app_login`,NOSUPERUSER NOBYPASSRLS)。

   ⚠️ 第 3 點是補救:本檔首版用 testcontainer 的預設(superuser)連線,
   13 條全綠 —— 然後 dev server 一打 `PATCH /api/settings/tenant` 就 500
   (`permission denied for table tenants`,42501)。`tenants` 對 `weyver_app`
   原本只有 SELECT,而特權連線把整件事遮住了。
   **本專案第六次踩到同一個坑**(`pitfall_privileged_lane_masks_security`)。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let appPool: pg.Pool
let db: DrizzleDb
let settings: SettingsService
let tenantA = 0
let tenantB = 0
let alice = 0
let bob = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri())
  await runMigrations(pool)
  db = createDrizzle(pool)

  const t = await db
    .insert(tenants)
    .values([{ name: "甲食品" }, { name: "乙食品" }])
    .returning()
  tenantA = t[0]?.id ?? 0
  tenantB = t[1]?.id ?? 0

  const u = await db
    .insert(users)
    .values([
      { authUserId: "auth-alice", email: "alice@weyver.test", name: "Alice" },
      { authUserId: "auth-bob", email: "bob@weyver.test", name: "Bob" },
    ])
    .returning()
  alice = u[0]?.id ?? 0
  bob = u[1]?.id ?? 0

  /* 🔴 服務一律拿 **app 車道**。用 testcontainer 預設的 superuser 連線的話,
     grant 與 RLS 都不執法,測試會綠給你看但線上 42501。 */
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  appPool = testPool(appUri.toString())
  settings = new SettingsService(new TenantDb(createDrizzle(appPool)))
}, 180_000)

afterAll(async () => {
  await appPool?.end()
  await pool?.end()
  await container?.stop()
})

/* 釘住測試方法本身的前提:服務用的連線**必須**是非特權的,否則下面全部白測 */
describe("測試前提", () => {
  it("🔴 服務走的是無 BYPASSRLS 的非 superuser", async () => {
    const r = await appPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    )
    expect(r.rows[0]?.rolsuper).toBe(false)
    expect(r.rows[0]?.rolbypassrls).toBe(false)
  })
})

describe("租戶設定", () => {
  it("預設值:繁中 + TWD + Asia/Taipei(既有租戶零遷移)", async () => {
    const s = await settings.getTenant(tenantA)
    expect(s.defaultLocale).toBe("zh-Hant")
    expect(s.defaultCurrency).toBe("TWD")
    expect(s.timezone).toBe("Asia/Taipei")
    expect(s.taxId).toBeNull()
  })

  it("可更新公司資料", async () => {
    const s = await settings.updateTenant(tenantA, {
      name: "甲食品股份有限公司",
      taxId: "12345678",
    })
    expect(s.name).toBe("甲食品股份有限公司")
    expect(s.taxId).toBe("12345678")
  })

  it("空 patch 不報錯,回現值(送空 body 不是錯誤,是沒有要改東西)", async () => {
    const s = await settings.updateTenant(tenantA, {})
    expect(s.name).toBe("甲食品股份有限公司")
  })

  it("🔴 統編格式由 DB CHECK 把關(非 8 碼數字寫不進去)", async () => {
    await expect(settings.updateTenant(tenantA, { taxId: "1234" })).rejects.toThrow()
  })
})

describe("🔴 個人設定的動態繼承(OQ-SC-3=A)", () => {
  it("未自訂 → 有效值 = 租戶預設,且標示為「未覆寫」", async () => {
    const s = await settings.getUser(tenantA, alice)
    expect(s.locale).toBe("zh-Hant")
    expect(s.displayTimezone).toBe("Asia/Taipei")
    expect(s.overrides).toEqual({ locale: false, displayTimezone: false })
  })

  it("自訂後 → 有效值改變,且標示為「已覆寫」", async () => {
    const s = await settings.updateUser(tenantA, alice, { locale: "ja" })
    expect(s.locale).toBe("ja")
    expect(s.overrides.locale).toBe(true)
    // 沒動到的軸仍在繼承
    expect(s.overrides.displayTimezone).toBe(false)
  })

  /* 🔴 動態繼承 vs「建帳號時複製」的分界。

     ⚠️ 這條測試最初寫成「bob 完全沒有偏好列」,**那在兩種語意下都會綠**
     (沒有列就只能回租戶值)—— 反向驗證時才發現它其實沒有釘住任何東西。
     真正的分界是「**有列、但該欄為 NULL**」:動態繼承必須在**讀取時**回落到租戶值,
     複製語意則會在該欄留下一個當時的具體值。故先讓 bob 自訂**另一軸**造出這一列。 */
  it("🔴 有偏好列但該欄未自訂 → 改租戶預設仍即時跟著變(已自訂者不動)", async () => {
    await settings.updateUser(tenantA, bob, { displayTimezone: "Asia/Taipei" })
    const bobRow = await settings.getUser(tenantA, bob)
    expect(bobRow.overrides).toEqual({ locale: false, displayTimezone: true }) // 列存在、locale 為 NULL

    await settings.updateTenant(tenantA, { defaultLocale: "en" })

    expect((await settings.getUser(tenantA, bob)).locale).toBe("en") // 讀取時回落 → 跟著變
    expect((await settings.getUser(tenantA, alice)).locale).toBe("ja") // 已自訂,不動
  })

  it("🔴 送 null = 取消自訂回到繼承(與「沒送該鍵」必須分得開)", async () => {
    const back = await settings.updateUser(tenantA, alice, { locale: null })
    expect(back.locale).toBe("en") // 回到當下的租戶預設
    expect(back.overrides.locale).toBe(false)
  })

  it("沒送該鍵 = 不動(不會被誤清成繼承)", async () => {
    await settings.updateUser(tenantA, alice, { displayTimezone: "Asia/Tokyo" })
    const s = await settings.updateUser(tenantA, alice, { locale: "ja" })
    expect(s.displayTimezone).toBe("Asia/Tokyo")
    expect(s.overrides.displayTimezone).toBe(true)
  })
})

describe("🔴 兩軸時區:業務日界線不可被個人覆寫", () => {
  it("個人改顯示時區,租戶的業務日界線不動", async () => {
    const before = await settings.getTenant(tenantA)
    await settings.updateUser(tenantA, alice, { displayTimezone: "America/New_York" })
    const after = await settings.getTenant(tenantA)
    /* `tenants.timezone` 是 autoNumber 日期段的依據 —— 若它會被個人設定影響,
       同一天不同人開的單會拿到不同日期段,那是不可回收的憑證錯誤。 */
    expect(after.timezone).toBe(before.timezone)
  })

  it("個人設定回傳含租戶預設,UI 才說得出「跟隨公司設定」是跟隨什麼", async () => {
    const s = await settings.getUser(tenantA, alice)
    expect(s.tenantDefaults.timezone).toBe("Asia/Taipei")
    expect(s.tenantDefaults.locale).toBe("en")
  })
})

/* 🔴 這一段是 dev server 打出 42501 之後補的。
   它們在特權連線下**恆綠**,只有走 app 車道才有意義。 */
describe("🔴 app 車道的權限邊界(DB 層執法,非程式碼自律)", () => {
  it("🔴 計費 / 配額 / 租戶身分欄位:app 車道寫不到(欄位級 GRANT)", async () => {
    /* 只授了 name / tax_id / logo / default_locale / default_currency / timezone 的 UPDATE。
       其餘欄位若哪天被順手加進 GRANT,這條會紅 —— 那正是它存在的理由:
       一個 app 層的 bug 不該能讓租戶自己解除停權或調高配額。 */
    for (const col of ["status", "plan_code", "max_forms", "auth_org_id", "parent_tenant_id"]) {
      await expect(
        appPool.query(`UPDATE tenants SET ${col} = NULL WHERE id = $1`, [tenantA]),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it("🔴 跨租戶寫入被 RLS 擋掉(不是靠服務層記得加 WHERE)", async () => {
    const client = await appPool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantA)])
      // 有 UPDATE 權限、SQL 也合法,但 policy 讓它一列都改不到
      const r = await client.query("UPDATE tenants SET name = 'HACKED' WHERE id = $1", [tenantB])
      expect(r.rowCount).toBe(0)
      await client.query("ROLLBACK")
    } finally {
      client.release()
    }
  })

  it("讀取行為不變 —— auth 於租戶語境建立前仍需查得到此表", async () => {
    const r = await appPool.query("SELECT count(*)::int AS n FROM tenants")
    expect(r.rows[0].n).toBeGreaterThanOrEqual(2)
  })
})

describe("🔴 跨租戶隔離", () => {
  it("甲租戶的個人設定不會出現在乙租戶", async () => {
    const inB = await settings.getUser(tenantB, alice)
    // 乙租戶沒有 alice 的偏好列 → 全繼承乙租戶的預設
    expect(inB.overrides).toEqual({ locale: false, displayTimezone: false })
    expect(inB.locale).toBe("zh-Hant")
  })

  it("改乙租戶設定不影響甲租戶", async () => {
    await settings.updateTenant(tenantB, { defaultCurrency: "USD" })
    expect((await settings.getTenant(tenantA)).defaultCurrency).toBe("TWD")
  })
})
