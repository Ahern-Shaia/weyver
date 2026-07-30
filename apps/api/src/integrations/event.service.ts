import { Injectable } from "@nestjs/common"
import type { Knex } from "knex"

/* 🔴 G-1 M1|事件匯流排寫入端。

   ## 為什麼要有這個東西

   `record.created` / `record.updated` 這兩個事件碼在 `notification-specs.ts` 宣告了、
   單元測試也覆蓋了 `levelAllows` 過濾邏輯 —— 但**從來沒有任何程式碼發射過它們**。
   全專案只有 2 個 `this.notify.*` 呼叫點,都在 `approval.service.ts`。
   結果:通知設定頁的**預設檔位**(「我建立的資料有變更時通知我」)承諾的行為從未發生。
   測試是綠的,因為它測的是純函式,不是「有沒有人呼叫它」。

   ## 為什麼是 outbox 而不是直接呼叫

   - webhook 送出是網路 I/O,**絕不能佔著業務交易**
   - 一份事件源同時餵通知與 webhook → 不會出現「通知有、webhook 沒有」的漂移
   - crash 不丟事件(AGENTS ⚙️ Outbox pattern)

   ## 車道

   寫入走**呼叫端的 knex tx**(app 車道,受 RLS 約束)—— 必須與業務變更同一個交易,
   否則就會退化成「資料寫了但事件沒寫」。扇出則是跨租戶維運,走特權車道。 */

export const EVENT_TYPES = {
  recordCreated: "record.created",
  recordUpdated: "record.updated",
  recordDeleted: "record.deleted",
} as const

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES]

export interface EmitEventInput {
  readonly tenantId: number
  readonly type: EventType
  readonly formId: number
  readonly recordId: number
  readonly actorId: number | null
  /* 🔴 只放**非敏感的參照資訊**。欄位值一律不進 outbox ——
     載荷在投遞當下依訂閱主體的 ACL 重算,先存等於凍結一份不受權限變更影響的快照。 */
  readonly meta?: Readonly<Record<string, unknown>>
}

@Injectable()
export class EventService {
  /* 呼叫端已在 tx 內 → 傳 trx 進來。**不自己開交易**。 */
  async emitInTx(trx: Knex.Transaction, input: EmitEventInput): Promise<void> {
    await trx("event_outbox").insert({
      tenant_id: input.tenantId,
      type: input.type,
      form_id: input.formId,
      record_id: input.recordId,
      actor_id: input.actorId,
      /* per (tenant, form, record) 遞增。業界一致**不保證投遞順序**
         (Stripe / Shopify 皆明載),消費端靠此丟棄舊序號。 */
      sequence: trx.raw(
        `(SELECT COALESCE(MAX(sequence), 0) + 1 FROM event_outbox
            WHERE tenant_id = ? AND form_id = ? AND record_id = ?)`,
        [input.tenantId, input.formId, input.recordId],
      ),
      meta: JSON.stringify(input.meta ?? {}),
    })
  }
}
