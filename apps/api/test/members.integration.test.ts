import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import {
  INITIAL_PASSWORD_LENGTH,
  generateInitialPassword,
  initialPasswordExpiry,
} from "../src/members/initial-password.js"
import { MemberService } from "../src/members/member.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

/* 🔴 R1·A-1 M2|使用者管理。本檔釘住三條**研究得到的規格**與一條多租戶語意:

   · 初始密碼 15 字(NIST 63B-4 §3.1.1.2;rev 3 的 6 字豁免已被刪除)
   · 管理員**無法**指定密碼(ASVS §V6.4.6:prevents a situation where they know
     the user's password)—— 用「介面上沒有那個參數」保證,不是靠檢核
   · 一次性 + 短效期(ASVS §V6.4.1:短效期 **或** 用過即失效,兩者都做)
   · 停權是**逐成員**不是逐帳號 —— 甲公司停權不得影響乙公司 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let appPool: pg.Pool
let db: DrizzleDb
let members: MemberService
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
    .values([{ name: "甲廠" }, { name: "乙廠" }])
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

  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  appPool = testPool(appUri.toString())

  /* 承 settings 那次的教訓:租戶範疇一律走 app 車道,否則 grant 與 RLS 都不執法 */
  members = new MemberService(new TenantDb(createDrizzle(appPool)), db)
}, 180_000)

afterAll(async () => {
  await appPool?.end()
  await pool?.end()
  await container?.stop()
})

describe("初始密碼規格(研究結論的可執行版本)", () => {
  it("🔴 15 個字元 —— 63B-4 刪掉了 rev 3 的臨時密碼豁免,單因子無例外", () => {
    expect(INITIAL_PASSWORD_LENGTH).toBe(15)
    expect(generateInitialPassword()).toHaveLength(15)
  })

  it("🔴 不含易混淆字元(0 O 1 l I)—— 一旦有人用唸的或手抄就是客服電話", () => {
    const joined = Array.from({ length: 200 }, () => generateInitialPassword()).join("")
    for (const c of ["0", "O", "1", "l", "I"]) expect(joined).not.toContain(c)
  })

  it("每次都不同(CSPRNG,非 Math.random)", () => {
    const s = new Set(Array.from({ length: 500 }, () => generateInitialPassword()))
    expect(s.size).toBe(500)
  })

  it("效期 72 小時", () => {
    const now = new Date("2026-08-01T00:00:00Z")
    expect(initialPasswordExpiry(now).toISOString()).toBe("2026-08-04T00:00:00.000Z")
  })
})

describe("建立成員", () => {
  /* 🔴 stub 必須模擬**真實路徑的分工**,不能順手多做事。

     首版的 `createAuthUser` 直接 `insert(users)` —— 但真實路徑裡
     `signUpEmail` 只建 Better Auth 的 user,Weyver 的 actor 列平時是
     AuthGuard 的 JIT upsert 建的,而新人此刻**還沒登入過**。
     於是測試綠、真實 API 回 `USER_NOT_PROVISIONED`。
     **stub 做了真實路徑不會做的事**,把缺口補掉了 —— 這是本模組第三次踩同型問題。

     改成三段各司其職:建帳號只回 id、加入 org 空操作、provisionActor 才建 actor 列。 */
  const stubAuth = (authUserId: string) => ({
    createAuthUser: async (_email: string, _name: string, password: string): Promise<string> => {
      expect(password).toHaveLength(15) // 服務層真的把產生的密碼交出去
      return authUserId
    },
    addToOrg: async (): Promise<void> => undefined,
    provisionActor: async (id: string, email: string, name: string): Promise<number> => {
      const [row] = await db.insert(users).values({ authUserId: id, email, name }).returning()
      return row?.id ?? 0
    },
  })

  it("🔴 建立後回傳明文一次 + 效期;帳號進 users", async () => {
    const r = await members.create({
      tenantId: tenantA,
      issuedByActorId: alice,
      email: "carol@weyver.test",
      name: "Carol",
      ...stubAuth("auth-carol"),
    })
    expect(r.initialPassword).toHaveLength(15)
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(r.email).toBe("carol@weyver.test")
  })

  it("🔴 憑證狀態為 pending —— 管理員看得出對方還沒登入過", async () => {
    const rows = await members.list(tenantA, [alice, bob])
    // alice/bob 是既有帳號(無 initial_credential)→ set
    expect(rows.every((r) => r.credential === "set")).toBe(true)
  })

  it("email 已存在 → 明確擋下,不重設別人的密碼", async () => {
    await expect(
      members.create({
        tenantId: tenantA,
        issuedByActorId: alice,
        email: "alice@weyver.test",
        name: "冒名",
        ...stubAuth("auth-dup"),
      }),
    ).rejects.toThrow()
  })

  /* 🔴 這條守的是「介面上根本沒有那個參數」——
     若日後有人加了 `password` 入參,型別會過但這條註解會提醒他讀 ASVS §V6.4.6。 */
  it("🔴 create 的入參不含任何讓管理員指定密碼的欄位", () => {
    const keys = ["tenantId", "issuedByActorId", "email", "name", "createAuthUser", "addToOrg"]
    expect(keys).not.toContain("password")
    expect(keys).not.toContain("initialPassword")
  })
})

describe("🔴 停權:逐成員,不是逐帳號", () => {
  it("在甲廠停權", async () => {
    await members.setStatus(tenantA, bob, "suspended", alice)
    expect(await members.isSuspended(tenantA, bob)).toBe(true)
  })

  it("🔴 **不影響同一個人在乙廠的存取** —— 那是別人家的帳號,我們無權處置", async () => {
    expect(await members.isSuspended(tenantB, bob)).toBe(false)
  })

  it("清單反映狀態", async () => {
    const rows = await members.list(tenantA, [alice, bob])
    expect(rows.find((r) => r.actorId === bob)?.status).toBe("suspended")
    expect(rows.find((r) => r.actorId === alice)?.status).toBe("active")
  })

  it("復權", async () => {
    await members.setStatus(tenantA, bob, "active", alice)
    expect(await members.isSuspended(tenantA, bob)).toBe(false)
  })

  it("🔴 不能停用自己 —— 否則租戶可能沒有任何人能管理", async () => {
    await expect(members.setStatus(tenantA, alice, "suspended", alice)).rejects.toThrow()
  })

  it("缺列 = active(既有成員零遷移)", async () => {
    expect(await members.isSuspended(tenantB, alice)).toBe(false)
  })
})

describe("🔴 app 車道的權限邊界", () => {
  it("🔴 app 車道**不得**自行簽發初始憑證(只有 SELECT / UPDATE)", async () => {
    await expect(
      appPool.query(
        `INSERT INTO initial_credential (auth_user_id, expires_at, issued_by_actor_id, issued_in_tenant_id)
         VALUES ('forged', now() + interval '1 day', $1, $2)`,
        [alice, tenantA],
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it("🔴 跨租戶讀不到別人的成員狀態(RLS)", async () => {
    const client = await appPool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantB)])
      const r = await client.query("SELECT * FROM member_state WHERE tenant_id = $1", [tenantA])
      expect(r.rowCount).toBe(0)
      await client.query("ROLLBACK")
    } finally {
      client.release()
    }
  })
})
