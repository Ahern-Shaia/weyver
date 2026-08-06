import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AiConfigService } from "../src/ai/ai-config.service.js"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants, users } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·AI-1 M1|AI 設定(`docs/modules/R1/ai-assist.md`)。

   本檔的主軸是**金鑰只進不出**與**同意鏈**。這兩件事在畫面上看不出來:
   一個回了明文的 API 與一個回了末四碼的 API,UI 長得一模一樣。

   ⚠️ app 車道走**限權角色**。2026-08-06 的 PDF M2 才因為這一點吃過虧
   ——測試用 superuser 當 app 車道時 grant 與 RLS 一律不執法,
   測試綠而 dev 500(`pitfall-privileged-lane-masks-security`)。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let tenantB = 0
let adminActor = 0
let plainActor = 0

const A = (): Record<string, string> => ({
  "x-dev-tenant": String(tenantA),
  "x-dev-actor": String(adminActor),
  "content-type": "application/json",
})
/* 沒有 admin 角色的人 —— 寫設定必須被擋 */
const PLAIN = (): Record<string, string> => ({ ...A(), "x-dev-actor": String(plainActor) })
const B = (): Record<string, string> => ({ ...A(), "x-dev-tenant": String(tenantB) })

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0

  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS;
     GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = appUri.toString()
  process.env.WEYVER_SECRET_KEK = "test-kek-material-for-ai-config-0000"

  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const [admin, plain] = await db
    .insert(users)
    .values([
      { authUserId: "ai-admin", email: "ai-admin@t.test", name: "AI 管理員" },
      { authUserId: "ai-plain", email: "ai-plain@t.test", name: "一般同事" },
    ])
    .returning({ id: users.id })
  adminActor = admin?.id ?? 0
  plainActor = plain?.id ?? 0

  for (const t of [tenantA, tenantB]) await app.get(AuthzRepository).seedSystemRoles(t)
  const assigned = await pool.query(
    `INSERT INTO role_members (tenant_id, role_id, actor_id)
     SELECT $1, id, $2 FROM roles WHERE tenant_id = $1 AND is_system = true AND key = 'admin'`,
    [tenantA, adminActor],
  )
  /* 影響 0 列 = 沒指派成功。讓它在這裡炸,而不是變成一條看不懂的斷言失敗 */
  if (assigned.rowCount !== 1) throw new Error("admin role assignment failed")
}, 180_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const patch = async (
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await app.inject({ method: "PATCH", url: "/api/ai/config", headers, payload })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

describe("AI 設定(BYO key)", () => {
  it("預設是關的,而且沒有金鑰", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ai/config", headers: A() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ enabled: false, hasApiKey: false, consentAt: null })
  })

  it("🔴 金鑰只進不出:回應裡只有末四碼,且整個回應不含明文", async () => {
    const secret = "sk-test-DO-NOT-LEAK-abcd1234WXYZ"
    const out = await patch(A(), {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKey: secret,
    })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ hasApiKey: true, apiKeyHint: "WXYZ" })
    /* 整包字串比對 —— 逐欄檢查會漏掉「不小心多回了一個欄位」那種情況 */
    expect(JSON.stringify(out.body)).not.toContain(secret)

    const again = await app.inject({ method: "GET", url: "/api/ai/config", headers: A() })
    expect(again.body).not.toContain(secret)
  })

  it("🔴 資料庫裡存的是密文,不是明文", async () => {
    const row = await pool.query(
      "SELECT api_key_sealed FROM tenant_ai_config WHERE tenant_id = $1",
      [tenantA],
    )
    const sealed = String(row.rows[0]?.api_key_sealed ?? "")
    expect(sealed).not.toContain("DO-NOT-LEAK")
    /* 🔴 驗**格式**而不只是「不含明文」。

       原本這裡只斷言長度 > 20 + 不含明文,而那兩條在「不小心存了整個
       `{sealed, fingerprint}` 物件」時**照樣會過**(pg 會把它 JSON 化)——
       真正的失敗要到解密時才炸。2026-08-06 實際踩到,由往返測試抓出來。
       `secret-box` 的格式逐字是 `v1.<kekId>.<wrappedDek>...`,共 8 段。 */
    expect(sealed.startsWith("v1.")).toBe(true)
    expect(sealed.split(".")).toHaveLength(8)
  })

  it("🔴 沒同意就不准啟用,而且錯誤訊息說得出缺什麼", async () => {
    const out = await patch(A(), { enabled: true })
    expect(out.status).toBe(400)
    expect(out.body.code).toBe("AI_CONFIG_INCOMPLETE")
    expect(String(out.body.message)).toContain("資料外送同意")
  })

  it("同意後才啟用得起來", async () => {
    const consented = await patch(A(), { consent: true })
    expect(consented.status).toBe(200)
    expect(consented.body.consentAt).not.toBeNull()

    const enabled = await patch(A(), { enabled: true })
    expect(enabled.status).toBe(200)
    expect(enabled.body).toMatchObject({ enabled: true })
  })

  it("🔴 撤回同意會一併關掉 AI —— 不是丟一個看不懂的約束錯誤", async () => {
    const revoked = await patch(A(), { consent: false })
    expect(revoked.status).toBe(200)
    expect(revoked.body).toMatchObject({ enabled: false, consentAt: null })
    /* 撤回後金鑰仍在(使用者只是收回同意,不是換金鑰)*/
    expect(revoked.body.hasApiKey).toBe(true)
  })

  /* ⚠️ 「非 admin 改不了設定」**在這一層表達不出來**:dev 車道一律
     `isSuperAdmin`(`authz-http.ts:22` 逐字「dev 一律 isSuperAdmin,整條分支
     從來沒有人走過」),於是 `permissions.isAdmin` 對任何 dev actor 都是 true。
     那條規則改由 `ai.controller.test.ts` 以假的 permissions 釘住 ——
     寫一條在這裡跑不出鑑別力的斷言,比沒有更糟。 */
  it("讀設定不限 admin —— 使用者要知道 AI 有沒有開,才知道入口為什麼是停用的", async () => {
    const read = await app.inject({ method: "GET", url: "/api/ai/config", headers: PLAIN() })
    expect(read.statusCode).toBe(200)
  })

  it("🔴 B 租戶讀不到 A 租戶的設定", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ai/config", headers: B() })
    expect(res.statusCode).toBe(200)
    /* A 已經設過 anthropic + 金鑰;B 必須是乾淨的 */
    expect(res.json()).toMatchObject({ provider: null, hasApiKey: false, enabled: false })
  })

  it("清空金鑰:hint 也要跟著消失", async () => {
    const out = await patch(A(), { apiKey: "" })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ hasApiKey: false, apiKeyHint: null })
  })

  it("🔴 `resolveForCall` 是唯一解密出口,設定不完整時回 null", async () => {
    const svc = app.get(AiConfigService)
    /* 剛剛清掉金鑰 → 不完整 */
    expect(await svc.resolveForCall(tenantA)).toBeNull()

    await patch(A(), { apiKey: "sk-round-trip-9999", consent: true })
    await patch(A(), { enabled: true })
    const resolved = await svc.resolveForCall(tenantA)
    /* 解得回原文 —— 這條同時驗了封裝與解封裝走的是同一把 KEK */
    expect(resolved?.apiKey).toBe("sk-round-trip-9999")
    expect(resolved?.provider).toBe("anthropic")
  })

  it("🔴 用量成功與失敗都記 —— 失敗一樣花錢", async () => {
    const svc = app.get(AiConfigService)
    const base = {
      tenantId: tenantA,
      actorId: adminActor,
      feature: "schema_proposal",
      provider: "anthropic",
      model: "claude-opus-4-7",
    }
    await svc.recordUsage({ ...base, inputTokens: 100, outputTokens: 50, ok: true })
    await svc.recordUsage({ ...base, inputTokens: 80, outputTokens: 0, ok: false })

    const usage = await svc.usageSince(tenantA)
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      calls: 2,
      failedCalls: 1,
      inputTokens: 180,
      outputTokens: 50,
    })
  })

  it("🔴 用量是租戶隔離的", async () => {
    const usage = await app.get(AiConfigService).usageSince(tenantB)
    expect(usage).toHaveLength(0)
  })
})
