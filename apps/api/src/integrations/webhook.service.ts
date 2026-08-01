import crypto from "node:crypto"
import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { TenantDb } from "../db/db.module.js"
import { webhookDeliveries, webhookEndpoints } from "../db/schema.js"
import { resolveSafeTarget } from "../http/ssrf-guard.js"
import { generateSecret } from "./webhook-signature.js"
import { newMessageId } from "./webhook-delivery.service.js"

/* G-1 M3|Webhook 端點管理。全程走 **app 車道**(RLS)—— 端點與投遞紀錄都是租戶資料。 */

export interface EndpointView {
  readonly id: number
  readonly url: string
  readonly description: string | null
  readonly eventTypes: string[]
  readonly verified: boolean
  readonly disabledAt: Date | null
  readonly disabledReason: string | null
  readonly createdAt: Date
}

@Injectable()
export class WebhookService {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  async list(tenantId: number): Promise<readonly EndpointView[]> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.tenantId, tenantId), isNull(webhookEndpoints.deletedAt)))
        .orderBy(desc(webhookEndpoints.createdAt)),
    )
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      description: r.description,
      eventTypes: r.eventTypes,
      verified: r.verifiedAt !== null,
      disabledAt: r.disabledAt,
      disabledReason: r.disabledReason,
      createdAt: r.createdAt,
    }))
  }

  /* 🔴 建立時就驗 URL —— 不要等到投遞才擋。使用者填錯要立刻知道,
     而且不驗就存等於把一個未經檢查的外連目標放進 DB。
     秘鑰**只在此刻回傳一次**,之後只能輪替不能再讀。 */
  async create(
    tenantId: number,
    actorId: number,
    input: { url: string; description?: string | undefined; eventTypes: readonly string[] },
  ): Promise<{ id: number; secret: string; verifyToken: string }> {
    await resolveSafeTarget(input.url)
    const secret = generateSecret()
    const verifyToken = crypto.randomBytes(24).toString("base64url")
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .insert(webhookEndpoints)
        .values({
          tenantId,
          url: input.url,
          description: input.description ?? null,
          eventTypes: [...input.eventTypes],
          secret,
          verifyToken,
          createdBy: actorId,
        })
        .returning({ id: webhookEndpoints.id }),
    )
    const row = rows[0]
    if (row === undefined) throw new Error("insert webhook_endpoint returned no row")
    return { id: row.id, secret, verifyToken }
  }

  /* 啟用挑戰:端點必須把 verifyToken 原樣回報,才證明「這個網址真的由你控制」。
     沒有這一步,任何人都能拿我們的伺服器去打第三方(放大器)。 */
  async verify(tenantId: number, endpointId: number, token: string): Promise<boolean> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({ verifyToken: webhookEndpoints.verifyToken })
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId)))
        .limit(1),
    )
    const expected = rows[0]?.verifyToken
    if (expected === undefined || expected === null) return false
    const a = Buffer.from(token)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false

    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(webhookEndpoints)
        .set({ verifiedAt: new Date(), verifyToken: null })
        .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId))),
    )
    return true
  }

  /* 零停機輪替:舊秘鑰留在 secretPrev,投遞時同一 header 出兩個簽章。 */
  async rotateSecret(tenantId: number, endpointId: number): Promise<{ secret: string }> {
    const next = generateSecret()
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(webhookEndpoints)
        .set({
          secretPrev: sql`${webhookEndpoints.secret}`,
          secret: next,
          secretRotatedAt: new Date(),
        })
        .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId))),
    )
    return { secret: next }
  }

  /* 停用後重新啟用要清掉失敗計數,否則一啟用就又達到停用門檻。 */
  async setEnabled(tenantId: number, endpointId: number, enabled: boolean): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(webhookEndpoints)
        .set(
          enabled
            ? {
                disabledAt: null,
                disabledReason: null,
                consecutiveFailures: 0,
                firstFailureAt: null,
              }
            : { disabledAt: new Date(), disabledReason: "使用者手動停用" },
        )
        .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId))),
    )
  }

  async remove(tenantId: number, endpointId: number): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(webhookEndpoints)
        .set({ deletedAt: new Date() })
        .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId))),
    )
  }

  async deliveries(tenantId: number, endpointId: number, limit = 50) {
    return this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: webhookDeliveries.id,
          messageId: webhookDeliveries.messageId,
          eventType: webhookDeliveries.eventType,
          status: webhookDeliveries.status,
          attempts: webhookDeliveries.attempts,
          responseCode: webhookDeliveries.responseCode,
          lastError: webhookDeliveries.lastError,
          createdAt: webhookDeliveries.createdAt,
          sentAt: webhookDeliveries.sentAt,
        })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.tenantId, tenantId),
            eq(webhookDeliveries.endpointId, endpointId),
          ),
        )
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(limit),
    )
  }

  /* 手動重送。**沿用原 messageId** —— 消費端才去重得掉(GitHub 同做法)。 */
  async redeliver(tenantId: number, deliveryId: number): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(webhookDeliveries)
        .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null })
        .where(and(eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.id, deliveryId))),
    )
  }

  /* 測試發送:排一筆 ping,走完整投遞路徑(含簽章與 SSRF 檢查)。
     只驗端點設定對不對,不需要真的有業務事件發生。 */
  async sendTest(tenantId: number, endpointId: number): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx.insert(webhookDeliveries).values({
        tenantId,
        endpointId,
        messageId: newMessageId(),
        eventType: "ping",
        payload: { type: "ping", tenantId, occurredAt: new Date().toISOString() },
      }),
    )
  }
}
