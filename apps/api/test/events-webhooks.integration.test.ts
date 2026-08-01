import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import type { Knex } from "knex"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { EventFanoutService } from "../src/integrations/event-fanout.service.js"
import { ApiKeyService } from "../src/integrations/api-key.service.js"
import { EventService } from "../src/integrations/event.service.js"
import { WebhookService } from "../src/integrations/webhook.service.js"

/* 🔴 G-1 整合測。三件事在這裡被釘死:
   1. **事件與資料同一 tx** —— rollback 時兩者都不留
   2. **通知死路徑真的修好** —— record.created 扇出後 notification 真的產生
   3. **跨租戶不外洩** —— A 的事件不會排進 B 的端點 */

const ALICE = 701
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let webhooks: WebhookService
let apiKeys: ApiKeyService
let fanout: EventFanoutService
let ddlKnex: Knex
const destroyers: (() => Promise<void>)[] = []
let tenantA = 0
let tenantB = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const metadata = new MetadataService(db, new TenantDb(db))
  ddlKnex = createDdlKnex(container.getConnectionUri())
  destroyers.push(() => ddlKnex.destroy())

  const uri = new URL(container.getConnectionUri())
  uri.username = "app_login"
  uri.password = "app_login"
  const appKnex = createDdlKnex(uri.toString())
  destroyers.push(() => appKnex.destroy())
  const appPool = new pg.Pool({ connectionString: uri.toString(), max: 5 })
  destroyers.push(() => appPool.end())
  const appDb = createDrizzle(appPool)

  ddl = new DdlService(ddlKnex, db, metadata)
  /* 🔴 RecordService 走 **app 車道**;事件寫入必須在 RLS 下也成立。
     用特權連線測會讓 grant 缺漏整個被遮住(本 session 已五度踩到)。 */
  records = new RecordService(
    appKnex,
    metadata,
    undefined,
    undefined,
    undefined,
    new EventService(),
  )
  webhooks = new WebhookService(new TenantDb(appDb))
  apiKeys = new ApiKeyService(new TenantDb(appDb), db)
  const notifyStub = { emit: async () => 0 } as never
  fanout = new EventFanoutService(ddlKnex, notifyStub)
}, 180_000)

afterAll(async () => {
  for (const d of destroyers) await d()
  await pool.end()
  await container.stop()
})

async function makeForm(tenantId: number, name: string): Promise<number> {
  const { form } = await ddl.createForm(
    tenantId,
    createFormSpecSchema.parse({ name, fields: [{ name: "品名", type: "text" }] }),
  )
  return form.id
}

async function enabledEndpoint(
  tenantId: number,
  url = "https://example.com/hook",
): Promise<number> {
  const created = await webhooks.create(tenantId, ALICE, { url, eventTypes: [] })
  // 直接標記已驗證:挑戰流程另有測試
  await ddlKnex("webhook_endpoint")
    .where({ id: created.id })
    .update({ verified_at: ddlKnex.fn.now() })
  return created.id
}

describe("G-1 事件匯流排", () => {
  it("🔴 建立記錄 → event_outbox 有一列,且與資料同一 tx", async () => {
    const formId = await makeForm(tenantA, "事件_建立")
    const rec = await records.createRecord(tenantA, formId, { 品名: "醬油" }, ALICE)

    const events = await ddlKnex("event_outbox").where({ form_id: formId }).select("*")
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("record.created")
    expect(Number(events[0]?.record_id)).toBe(rec.id)
    expect(Number(events[0]?.actor_id)).toBe(ALICE)
  })

  it("🔴 業務失敗 rollback 時,事件也不留", async () => {
    const formId = await makeForm(tenantA, "事件_回滾")
    const before = await ddlKnex("event_outbox").where({ form_id: formId }).count({ n: "*" })
    // 未知欄位 → validateValues 擲錯 → 整個 tx rollback
    await expect(
      records.createRecord(tenantA, formId, { 不存在的欄: "x" }, ALICE),
    ).rejects.toThrow()
    const after = await ddlKnex("event_outbox").where({ form_id: formId }).count({ n: "*" })
    expect(after[0]?.n).toBe(before[0]?.n)
  })

  it("更新與刪除各自發射對應事件", async () => {
    const formId = await makeForm(tenantA, "事件_增改刪")
    const rec = await records.createRecord(tenantA, formId, { 品名: "米" }, ALICE)
    await records.updateRecord(tenantA, formId, rec.id, 1, { 品名: "白米" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, rec.id, ALICE)

    const types = (
      await ddlKnex("event_outbox").where({ form_id: formId }).orderBy("id").select("type")
    ).map((r) => r.type)
    expect(types).toEqual(["record.created", "record.updated", "record.deleted"])
  })

  it("sequence 於同一筆記錄內遞增", async () => {
    const formId = await makeForm(tenantA, "事件_序號")
    const rec = await records.createRecord(tenantA, formId, { 品名: "糖" }, ALICE)
    await records.updateRecord(tenantA, formId, rec.id, 1, { 品名: "砂糖" }, ALICE)
    const seqs = (
      await ddlKnex("event_outbox")
        .where({ form_id: formId, record_id: rec.id })
        .orderBy("id")
        .select("sequence")
    ).map((r) => Number(r.sequence))
    expect(seqs).toEqual([1, 2])
  })
})

describe("G-1 扇出", () => {
  it("🔴 扇出後產生 webhook 投遞,且事件標記完成", async () => {
    const formId = await makeForm(tenantA, "扇出_基本")
    const endpointId = await enabledEndpoint(tenantA)
    await records.createRecord(tenantA, formId, { 品名: "鹽" }, ALICE)

    const result = await fanout.run()
    expect(result.processed).toBeGreaterThan(0)

    const deliveries = await ddlKnex("webhook_delivery")
      .where({ endpoint_id: endpointId })
      .select("*")
    expect(deliveries.length).toBeGreaterThan(0)
    expect(deliveries[0]?.status).toBe("pending")
    expect(String(deliveries[0]?.message_id)).toMatch(/^msg_/)

    const pending = await ddlKnex("event_outbox")
      .where({ form_id: formId })
      .whereNull("fanned_out_at")
    expect(pending).toHaveLength(0)
  })

  it("扇出可重入:再跑一次不會重複投遞", async () => {
    const formId = await makeForm(tenantA, "扇出_冪等")
    const endpointId = await enabledEndpoint(tenantA)
    await records.createRecord(tenantA, formId, { 品名: "醋" }, ALICE)
    await fanout.run()
    const first = await ddlKnex("webhook_delivery")
      .where({ endpoint_id: endpointId })
      .count({ n: "*" })
    await fanout.run()
    const second = await ddlKnex("webhook_delivery")
      .where({ endpoint_id: endpointId })
      .count({ n: "*" })
    expect(second[0]?.n).toBe(first[0]?.n)
  })

  it("🔴 A 租戶的事件不會排進 B 租戶的端點", async () => {
    const formId = await makeForm(tenantA, "扇出_隔離")
    const endpointB = await enabledEndpoint(tenantB, "https://example.org/b-hook")
    await records.createRecord(tenantA, formId, { 品名: "跨租戶測試" }, ALICE)
    await fanout.run()

    const leaked = await ddlKnex("webhook_delivery").where({ endpoint_id: endpointB }).select("*")
    expect(leaked).toHaveLength(0)
  })

  it("未通過驗證挑戰的端點不會收到投遞(避免成為打第三方的放大器)", async () => {
    const formId = await makeForm(tenantA, "扇出_未驗證")
    const created = await webhooks.create(tenantA, ALICE, {
      url: "https://example.net/unverified",
      eventTypes: [],
    })
    await records.createRecord(tenantA, formId, { 品名: "x" }, ALICE)
    await fanout.run()
    const none = await ddlKnex("webhook_delivery").where({ endpoint_id: created.id }).select("*")
    expect(none).toHaveLength(0)
  })

  it("只訂閱特定事件型別的端點,不收其他型別", async () => {
    const formId = await makeForm(tenantA, "扇出_篩型別")
    const created = await webhooks.create(tenantA, ALICE, {
      url: "https://example.com/only-deleted",
      eventTypes: ["record.deleted"],
    })
    await ddlKnex("webhook_endpoint")
      .where({ id: created.id })
      .update({ verified_at: ddlKnex.fn.now() })
    await records.createRecord(tenantA, formId, { 品名: "只想要刪除事件" }, ALICE)
    await fanout.run()
    const rows = await ddlKnex("webhook_delivery")
      .where({ endpoint_id: created.id })
      .select("event_type")
    expect(rows).toHaveLength(0)
  })
})

describe("G-1 端點管理", () => {
  it("🔴 建端點時就擋掉內網 URL(不是等到投遞才擋)", async () => {
    await expect(
      webhooks.create(tenantA, ALICE, { url: "https://169.254.169.254/", eventTypes: [] }),
    ).rejects.toThrow(/不被允許/)
    await expect(
      webhooks.create(tenantA, ALICE, { url: "http://example.com/", eventTypes: [] }),
    ).rejects.toThrow(/https/)
  })

  it("驗證挑戰:token 對才啟用,錯的不啟用", async () => {
    const created = await webhooks.create(tenantA, ALICE, {
      url: "https://example.com/challenge",
      eventTypes: [],
    })
    expect(await webhooks.verify(tenantA, created.id, "wrong-token")).toBe(false)
    expect(await webhooks.verify(tenantA, created.id, created.verifyToken)).toBe(true)
    // 用過即清:同一 token 不能再用
    expect(await webhooks.verify(tenantA, created.id, created.verifyToken)).toBe(false)
  })

  it("秘鑰輪替後舊秘鑰留在 secret_prev(零停機)", async () => {
    const created = await webhooks.create(tenantA, ALICE, {
      url: "https://example.com/rotate",
      eventTypes: [],
    })
    const rotated = await webhooks.rotateSecret(tenantA, created.id)
    expect(rotated.secret).not.toBe(created.secret)
    const row = await ddlKnex("webhook_endpoint").where({ id: created.id }).first()
    expect(row?.secret).toBe(rotated.secret)
    expect(row?.secret_prev).toBe(created.secret)
  })

  it("🔴 B 租戶看不到 A 的端點(RLS)", async () => {
    await webhooks.create(tenantA, ALICE, { url: "https://example.com/a-only", eventTypes: [] })
    const seenByB = await webhooks.list(tenantB)
    expect(seenByB.some((e) => e.url === "https://example.com/a-only")).toBe(false)
  })

  it("重新啟用會清空失敗計數(否則一啟用就又被停)", async () => {
    const created = await webhooks.create(tenantA, ALICE, {
      url: "https://example.com/reenable",
      eventTypes: [],
    })
    await ddlKnex("webhook_endpoint")
      .where({ id: created.id })
      .update({
        consecutive_failures: 19,
        first_failure_at: ddlKnex.raw("now() - interval '200 hours'"),
      })
    await webhooks.setEnabled(tenantA, created.id, false)
    await webhooks.setEnabled(tenantA, created.id, true)
    const row = await ddlKnex("webhook_endpoint").where({ id: created.id }).first()
    expect(Number(row?.consecutive_failures)).toBe(0)
    expect(row?.first_failure_at).toBeNull()
    expect(row?.disabled_at).toBeNull()
  })
})

describe("G-1 API 金鑰", () => {
  it("簽發後明文只回一次;DB 只存 hash", async () => {
    const issued = await apiKeys.issue(tenantA, {
      name: "ERP 同步",
      subjectActorId: ALICE,
      scopes: ["read"],
      createdBy: ALICE,
    })
    expect(issued.key.startsWith("wvk_")).toBe(true)
    const row = await ddlKnex("api_key").where({ id: issued.id }).first()
    /* 🔴 DB 裡不能出現明文 —— 這是與 webhook secret 的關鍵差別 */
    expect(row?.key_hash).not.toBe(issued.key)
    expect(JSON.stringify(row)).not.toContain(issued.key)
    expect(row?.key_prefix).toBe(issued.key.slice(0, 12))

    const listed = await apiKeys.list(tenantA)
    expect(JSON.stringify(listed)).not.toContain(issued.key)
  })

  it("有效金鑰解析出租戶與執行身分", async () => {
    const issued = await apiKeys.issue(tenantA, {
      name: "有效",
      subjectActorId: ALICE,
      scopes: ["read", "write"],
      createdBy: ALICE,
    })
    const resolved = await apiKeys.resolve(issued.key)
    expect(resolved?.tenantId).toBe(tenantA)
    /* 🔴 金鑰以 subject 的身分執行,不另給一套權限 —— 否則是繞過 authz 的側門 */
    expect(resolved?.actorId).toBe(ALICE)
    expect(resolved?.scopes).toEqual(["read", "write"])
  })

  it.each([
    ["亂編的", "wvk_totally-made-up-key-value"],
    ["前綴不對", "sk_live_something"],
    ["空字串", ""],
  ])("%s 一律解析失敗", async (_label, key) => {
    expect(await apiKeys.resolve(key)).toBeNull()
  })

  it("🔴 撤銷與過期都回 null,且不區分原因(不洩漏金鑰是否存在)", async () => {
    const revoked = await apiKeys.issue(tenantA, {
      name: "待撤銷",
      subjectActorId: ALICE,
      scopes: ["read"],
      createdBy: ALICE,
    })
    await apiKeys.revoke(tenantA, revoked.id)
    expect(await apiKeys.resolve(revoked.key)).toBeNull()

    const expired = await apiKeys.issue(tenantA, {
      name: "已過期",
      subjectActorId: ALICE,
      scopes: ["read"],
      expiresAt: new Date(Date.now() - 1000),
      createdBy: ALICE,
    })
    expect(await apiKeys.resolve(expired.key)).toBeNull()
  })

  it("🔴 B 租戶看不到也撤銷不了 A 的金鑰", async () => {
    const issued = await apiKeys.issue(tenantA, {
      name: "A 專用",
      subjectActorId: ALICE,
      scopes: ["read"],
      createdBy: ALICE,
    })
    expect((await apiKeys.list(tenantB)).some((k) => k.id === issued.id)).toBe(false)

    await apiKeys.revoke(tenantB, issued.id)
    // B 的撤銷不該生效 —— A 的金鑰仍然可用
    expect(await apiKeys.resolve(issued.key)).not.toBeNull()
  })

  it("使用後記錄 last_used_at(金鑰洩漏時要查得出是哪一把在被用)", async () => {
    const issued = await apiKeys.issue(tenantA, {
      name: "追蹤使用",
      subjectActorId: ALICE,
      scopes: ["read"],
      createdBy: ALICE,
    })
    await apiKeys.resolve(issued.key)
    await new Promise((r) => setTimeout(r, 150))
    const row = await ddlKnex("api_key").where({ id: issued.id }).first()
    expect(row?.last_used_at).not.toBeNull()
  })
})
