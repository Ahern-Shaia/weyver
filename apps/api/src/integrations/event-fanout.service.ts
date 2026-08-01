import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"
import { DDL_KNEX } from "../db/db.module.js"
import { DATA_SCHEMA, physicalTableName } from "../form-engine/identifiers.js"
import { NotificationService } from "../notifications/notification.service.js"
import { newMessageId } from "./webhook-delivery.service.js"

/* 🔴 G-1 M1|事件扇出。**一份事件源餵兩個消費者。**

   ## 這支 cron 同時修好一個既有的洞

   `record.created` / `record.updated` 在此之前從未被發射過(全專案只有 2 個
   `this.notify.*` 呼叫點,都在 approval)。通知設定頁的**預設檔位**
   (「我建立的資料有變更時通知我」)承諾的行為從未發生。
   事件匯流排接上後,通知與 webhook 一起被餵 —— 而且是**同一份**事件,
   不會出現「通知有、webhook 沒有」的漂移。

   ## 為什麼是 cron 而不是佇列

   BullMQ / DBOS 在 AGENTS 與 docs/20 被當既定選型寫著,但**都沒安裝**。
   實際在 prod 跑的是 `notification_delivery` + 每分鐘 cron 抽取。復用它,
   少一個依賴、少一個 Redis 故障面(OQ-WH-1=A)。

   ## 冪等

   `fanned_out_at` 標記 + 每批獨立 tx。中途 crash 最壞是**重扇出一次**:
   通知端會多一則、webhook 端會多一次投遞。at-least-once 是業界共識
   (無任何廠商宣稱 exactly-once),消費端靠 `webhook-id` 去重。 */

const BATCH_LIMIT = 200
const FANOUT_LOCK_KEY = 909_004

interface OutboxRow {
  id: number
  tenant_id: number
  type: string
  form_id: number | null
  record_id: number | null
  actor_id: number | null
  created_by: number | null
}

@Injectable()
export class EventFanoutService {
  private readonly logger = new Logger(EventFanoutService.name)

  constructor(
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(NotificationService) private readonly notify: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: "event.fanout" })
  async scheduled(): Promise<void> {
    try {
      const result = await this.run()
      if (result.processed > 0) this.logger.log(`event fanout: ${JSON.stringify(result)}`)
    } catch (error) {
      this.logger.error(
        `event fanout failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async run(): Promise<{ processed: number; deliveries: number; skipped: boolean }> {
    const gate = await this.knex.raw<{ rows: { locked: boolean }[] }>(
      "SELECT pg_try_advisory_lock(?) AS locked",
      [FANOUT_LOCK_KEY],
    )
    if (gate.rows[0]?.locked !== true) return { processed: 0, deliveries: 0, skipped: true }
    try {
      const events = await this.claim()
      let deliveries = 0
      for (const event of events) {
        deliveries += await this.fanOut(event)
        await this.knex("event_outbox")
          .where({ id: event.id })
          .update({ fanned_out_at: this.knex.fn.now() })
      }
      return { processed: events.length, deliveries, skipped: false }
    } finally {
      await this.knex.raw("SELECT pg_advisory_unlock(?)", [FANOUT_LOCK_KEY])
    }
  }

  /* 跨租戶維運 → 特權車道。順帶撈 created_by 供通知的 involved 判定。 */
  private async claim(): Promise<OutboxRow[]> {
    const { rows } = await this.knex.raw<{ rows: OutboxRow[] }>(
      `SELECT id, tenant_id, type, form_id, record_id, actor_id, NULL::bigint AS created_by
         FROM event_outbox
        WHERE fanned_out_at IS NULL
        ORDER BY occurred_at
        LIMIT ?`,
      [BATCH_LIMIT],
    )
    return rows
  }

  private async fanOut(event: OutboxRow): Promise<number> {
    if (event.form_id === null) return 0
    await this.toNotifications(event)
    return this.toWebhooks(event)
  }

  /* 補上從未接通的那條線。`NotificationService.emit` 內部已 try/catch
     (通知是非關鍵路徑),此處不再包一層。 */
  private async toNotifications(event: OutboxRow): Promise<void> {
    if (event.type !== "record.created" && event.type !== "record.updated") return
    const createdBy = await this.recordOwner(event)
    await this.notify.emit({
      tenantId: event.tenant_id,
      event: event.type,
      formId: event.form_id ?? 0,
      recordId: event.record_id,
      actorId: event.actor_id,
      involvedActorIds: createdBy === null ? [] : [createdBy],
    })
  }

  /* involved 判定需要「這筆記錄是誰建的」。動態表在 data schema,以物理表名查。 */
  private async recordOwner(event: OutboxRow): Promise<number | null> {
    if (event.form_id === null || event.record_id === null) return null
    try {
      /* 🔴 表名走 `physicalTableName` + knex 的 `??` identifier 綁定,
         不做字串替換 —— AGENTS 鐵則 1:動態 identifier 一律經白名單解析後由驅動加引號。
         這裡的 form_id 雖然來自 DB(必為數字),但不能因為「這次安全」就留下壞樣板。 */
      const { rows } = await this.knex.raw<{ rows: { created_by: number | null }[] }>(
        "SELECT created_by FROM ??.?? WHERE id = ? AND tenant_id = ?",
        [DATA_SCHEMA, physicalTableName(event.form_id), event.record_id, event.tenant_id],
      )
      return rows[0]?.created_by ?? null
    } catch {
      // 表已被硬刪等情況:不讓它擋住整批扇出
      return null
    }
  }

  /* 依訂閱建立投遞列。**載荷此刻只放 thin 參照** —— fat 模式的欄位值
     由投遞端依訂閱主體的 ACL 在送出當下重算(webhook-and-events §4.4),
     在這裡就展開等於凍結一份不受權限變更影響的快照。 */
  private async toWebhooks(event: OutboxRow): Promise<number> {
    const { rows: endpoints } = await this.knex.raw<{ rows: { id: number }[] }>(
      `SELECT id FROM webhook_endpoint
        WHERE tenant_id = ?
          AND deleted_at IS NULL
          AND disabled_at IS NULL
          AND verified_at IS NOT NULL
          AND (cardinality(event_types) = 0 OR ? = ANY(event_types))`,
      [event.tenant_id, event.type],
    )
    if (endpoints.length === 0) return 0

    const payload = {
      type: event.type,
      tenantId: event.tenant_id,
      formId: event.form_id,
      recordId: event.record_id,
      occurredAt: new Date().toISOString(),
    }
    await this.knex("webhook_delivery").insert(
      endpoints.map((e) => ({
        tenant_id: event.tenant_id,
        endpoint_id: e.id,
        event_id: event.id,
        message_id: newMessageId(),
        event_type: event.type,
        payload: JSON.stringify(payload),
      })),
    )
    return endpoints.length
  }
}
