import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Knex } from "knex"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { ApiKeyService } from "../src/integrations/api-key.service.js"
import { EventFanoutService } from "../src/integrations/event-fanout.service.js"
import { EventService } from "../src/integrations/event.service.js"
import { WebhookDeliveryService } from "../src/integrations/webhook-delivery.service.js"
import { WebhookService } from "../src/integrations/webhook.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

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
let delivery: WebhookDeliveryService
let ddlKnex: Knex
const destroyers: (() => Promise<void>)[] = []
let tenantA = 0
let tenantB = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri(), 8)
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
  const appPool = testPool(uri.toString(), 5)
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
  delivery = new WebhookDeliveryService(ddlKnex)
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

  /* ⚠️ audit-D §3-2|**這條測試原本不構成證據,標題已改成它真正證明的事。**

     原標題是「業務失敗 rollback 時,事件也不留」,而它用的觸發點是**未知欄位**
     —— `validateValues` 在 `insertOne` 的**開頭**就擲錯,`emitInTx` 根本沒執行到。
     也就是說,就算事件寫在交易外面,這條測試一樣會綠。

     🔴 **更強的性質(emit 之後才失敗 → 事件一併回滾)目前無法從公開 API 構造**:
     `createRecord` 的 emit 之後只剩搜尋索引寫入,而那支沒有可從外部觸發的失敗路徑;
     DB 約束違反都發生在 emit 之前。同一 tx 的保證目前**只由結構提供**
     —— `emitInTx(trx, …)` 收的就是那個 trx。**誠實記錄:這一條沒有測試在守。** */
  it("寫入被擋下時(驗證階段)不會留下事件", async () => {
    const formId = await makeForm(tenantA, "事件_回滾")
    const before = await ddlKnex("event_outbox").where({ form_id: formId }).count({ n: "*" })
    await expect(
      records.createRecord(tenantA, formId, { 不存在的欄: "x" }, ALICE),
    ).rejects.toThrow()
    const after = await ddlKnex("event_outbox").where({ form_id: formId }).count({ n: "*" })
    expect(after[0]?.n).toBe(before[0]?.n)
  })

  /* 🔴 audit-D 之外的發現(2026-08-04)|**主檔明細這條路徑一個事件都沒發。**

     `emitInTx` 掛在 `createRecord` / `updateRecord` 那一層,而 `saveWithLines`
     自己呼叫 `insertOne` / `updateOne` —— 於是繞過去了:用主檔明細畫面存的記錄,
     webhook 訂閱者收不到任何通知。

     ⚠️ 與 2026-08-03 修過的「主檔明細從未寫過搜尋索引」是**同一個形狀**,
     而且就在同一段程式碼裡:索引補了、事件沒補。
     **一起補的時候漏掉一半,比兩個都沒做更難發現。** */
  it("🔴 主檔明細儲存:主檔與每一列明細都要發事件", async () => {
    const parentId = await makeForm(tenantA, "事件_主檔")
    const { form: child } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "事件_明細",
        parentFormId: parentId,
        fields: [{ name: "品項", type: "text" }],
      }),
    )

    const headerId = await records.saveWithLines(
      tenantA,
      parentId,
      child.id,
      { values: { 品名: "採購單" } },
      [{ values: { 品項: "A" } }, { values: { 品項: "B" } }],
      ALICE,
    )

    const parentEvents = await ddlKnex("event_outbox").where({ form_id: parentId }).select("*")
    expect(parentEvents).toHaveLength(1)
    expect(parentEvents[0]?.type).toBe("record.created")

    const lineEvents = await ddlKnex("event_outbox").where({ form_id: child.id }).select("*")
    expect(lineEvents).toHaveLength(2)
    expect(lineEvents.every((e) => e.type === "record.created")).toBe(true)

    /* 再存一次:主檔轉 updated,既有明細轉 updated,移除的那一列發 deleted */
    const keptId = Number(lineEvents[0]?.record_id)
    await records.saveWithLines(
      tenantA,
      parentId,
      child.id,
      { id: headerId.header.id, expectedVersion: 1, values: { 品名: "採購單" } },
      [{ id: keptId, values: { 品項: "A2" } }],
      ALICE,
    )
    const after = await ddlKnex("event_outbox").where({ form_id: parentId }).select("*")
    expect(after.map((e) => e.type)).toContain("record.updated")
    const lineAfter = await ddlKnex("event_outbox").where({ form_id: child.id }).select("*")
    expect(lineAfter.map((e) => e.type)).toContain("record.updated")
    expect(lineAfter.map((e) => e.type)).toContain("record.deleted")
  })

  /* 🔴 audit-E §2.4|**列舉所有寫入路徑,而不是再補一條個案測試。**

     這個形狀已經第四次:批次匯入沒寫索引 · 子表沒寫索引 · 子表沒發事件 ·
     批次匯入沒發事件。每次都是「補了個案、下一條路徑照樣漏」——
     因為**沒有任何東西在列舉出口**。

     這條測試的意義不是驗證某一條路徑,而是:**新增寫入路徑時它會紅**,
     逼人回來確認事件有沒有一起補。 */
  it("🔴 每一條寫入路徑都要發事件(新增路徑時這條會紅)", async () => {
    const formId = await makeForm(tenantA, "事件_全路徑")
    const count = async (): Promise<number> => {
      const rows = await ddlKnex("event_outbox").where({ form_id: formId }).select("type")
      return rows.length
    }

    /* ① 單筆建立 */
    const one = await records.createRecord(tenantA, formId, { 品名: "單筆" }, ALICE)
    expect(await count()).toBe(1)

    /* ② 批次匯入 —— 逐列各一個事件 */
    await records.createManyRecords(
      tenantA,
      formId,
      [{ 品名: "匯入1" }, { 品名: "匯入2" }, { 品名: "匯入3" }],
      ALICE,
    )
    expect(await count()).toBe(4)

    /* ③ 更新 ④ 刪除 */
    await records.updateRecord(tenantA, formId, one.id, 1, { 品名: "改" }, ALICE)
    await records.softDeleteRecord(tenantA, formId, one.id, ALICE)
    expect(await count()).toBe(6)

    /* ⑤ 還原 —— 訂閱者收過 deleted,少了這一發他手上那筆就永遠停在「已刪除」 */
    await records.restoreRecord(tenantA, formId, one.id, ALICE)
    const types = (await ddlKnex("event_outbox").where({ form_id: formId }).select("type")).map(
      (r) => String(r.type),
    )
    expect(types).toHaveLength(7)
    expect(types.filter((t) => t === "record.created")).toHaveLength(4)
    expect(types.filter((t) => t === "record.deleted")).toHaveLength(1)
    expect(types.filter((t) => t === "record.updated")).toHaveLength(2) // 改 + 還原
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

/* 🔴 W7|投遞紀錄保留期。在此之前每一列都帶一份完整的載荷(業務資料快照)
   與回應內容,而**沒有任何機制會清掉它們** —— 既是無上限成長,也是保留期破口。 */
describe("G-1 投遞紀錄保留期", () => {
  const agedDelivery = async (
    tenantId: number,
    endpointId: number,
    ageDays: number,
    status = "sent",
  ): Promise<number> => {
    const [row] = await ddlKnex("webhook_delivery")
      .insert({
        tenant_id: tenantId,
        endpoint_id: endpointId,
        message_id: `msg_${String(ageDays)}_${String(Date.now())}_${String(Math.trunc(ageDays * 7))}`,
        event_type: "record.created",
        payload: JSON.stringify({ 品名: "不該無限期留著的業務資料" }),
        status,
        response_body: "ok",
        created_at: ddlKnex.raw(`now() - interval '${String(ageDays)} days'`),
      })
      .returning("id")
    return Number((row as { id: number | string }).id)
  }

  it("🔴 超過 30 天:清掉載荷與回應內容,但列留著(內控要答得出有沒有送出去)", async () => {
    const endpointId = await enabledEndpoint(tenantA, "https://example.com/retention")
    const oldId = await agedDelivery(tenantA, endpointId, 40)
    const freshId = await agedDelivery(tenantA, endpointId, 1)

    const result = await delivery.enforceRetention()
    expect(result.pruned).toBeGreaterThan(0)

    const old = await ddlKnex("webhook_delivery").where({ id: oldId }).first()
    expect(old?.payload).toEqual({})
    expect(old?.response_body).toBeNull()
    expect(old?.pruned_at).not.toBeNull()
    /* 列本身不能消失 —— 「我們有沒有把這筆資料送給外部端點」是內控要問的 */
    expect(old?.message_id).toBeTruthy()

    const fresh = await ddlKnex("webhook_delivery").where({ id: freshId }).first()
    expect(fresh?.pruned_at).toBeNull()
    expect(fresh?.payload).not.toEqual({})
  })

  it("🔴 還在 pending 的不清 —— 那是待送內容,清掉就永遠送不出去了", async () => {
    const endpointId = await enabledEndpoint(tenantA, "https://example.com/pending")
    const pendingId = await agedDelivery(tenantA, endpointId, 40, "pending")
    await delivery.enforceRetention()
    const row = await ddlKnex("webhook_delivery").where({ id: pendingId }).first()
    expect(row?.pruned_at).toBeNull()
    expect(row?.payload).not.toEqual({})
  })

  it("超過一年整列刪除", async () => {
    const endpointId = await enabledEndpoint(tenantA, "https://example.com/ancient")
    const ancientId = await agedDelivery(tenantA, endpointId, 400)
    await delivery.enforceRetention()
    expect(await ddlKnex("webhook_delivery").where({ id: ancientId }).first()).toBeUndefined()
  })

  /* 🔴 少了這道閘門,按重送會送出一份空載荷而且回 200 —— 對消費端就是
     一筆「內容突然變空」的事件,比明白地說「重送不了」糟得多。 */
  it("🔴 內容被清掉的投遞不得重送,且訊息說得出替代做法", async () => {
    const endpointId = await enabledEndpoint(tenantA, "https://example.com/no-redeliver")
    const oldId = await agedDelivery(tenantA, endpointId, 40)
    await delivery.enforceRetention()

    await expect(webhooks.redeliver(tenantA, oldId)).rejects.toThrow(/保留期|無法重送/)
    /* 狀態不得被改成 pending —— 否則投遞器下一輪就把空載荷送出去了 */
    const row = await ddlKnex("webhook_delivery").where({ id: oldId }).first()
    expect(row?.status).toBe("sent")
  })
})
