import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import {
  notificationDeliveries,
  notificationPrefs,
  notificationSettings,
  notifications,
} from "../db/schema.js"
import { DEFAULT_LEVEL, type NotificationLevel } from "./notification-specs.js"

/* H-1 M1 資料存取。通知類為 Tier-1 metadata 性質 → 特權 DRIZZLE 車道 + app 層 tenant scope
   (與 authz / actions 同慣例);RLS 於 DB 層兜底。 */

export interface NotificationRow {
  readonly id: number
  readonly event: string
  readonly formId: number | null
  readonly recordId: number | null
  readonly title: string
  readonly actorId: number | null
  readonly readAt: Date | null
  readonly createdAt: Date
}

export interface PrefRow {
  readonly scope: string
  readonly scopeId: number | null
  readonly level: number
  readonly customEvents: readonly string[] | null
}

export interface NewNotification {
  readonly tenantId: number
  readonly recipientActorId: number
  readonly event: string
  readonly formId: number | null
  readonly recordId: number | null
  readonly title: string
  readonly actorId: number | null
}

@Injectable()
export class NotificationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /* 批次插入 + 對應通道 delivery。**通知與寄送分兩張表**(§0.4.2)。 */
  async createMany(rows: readonly NewNotification[], channels: readonly string[]): Promise<number> {
    if (rows.length === 0) return 0
    const inserted = await this.db
      .insert(notifications)
      .values(rows.map((r) => ({ ...r })))
      .returning({ id: notifications.id, tenantId: notifications.tenantId })
    const deliveries = inserted.flatMap((n) =>
      channels.map((channel) => ({
        tenantId: n.tenantId,
        notificationId: n.id,
        channel,
      })),
    )
    if (deliveries.length > 0) await this.db.insert(notificationDeliveries).values(deliveries)
    return inserted.length
  }

  async listForActor(
    tenantId: number,
    actorId: number,
    limit: number,
  ): Promise<readonly NotificationRow[]> {
    return this.db
      .select({
        id: notifications.id,
        event: notifications.event,
        formId: notifications.formId,
        recordId: notifications.recordId,
        title: notifications.title,
        actorId: notifications.actorId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(
        and(eq(notifications.tenantId, tenantId), eq(notifications.recipientActorId, actorId)),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
  }

  /* 走部分索引 `WHERE read_at IS NULL`(Discourse 實作;未讀是最高頻查詢)。 */
  async unreadCount(tenantId: number, actorId: number): Promise<number> {
    const rows = await this.db
      .select({ n: sql<string>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientActorId, actorId),
          isNull(notifications.readAt),
        ),
      )
    return Number(rows[0]?.n ?? 0)
  }

  async markRead(tenantId: number, actorId: number, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientActorId, actorId),
          inArray(notifications.id, [...ids]),
          isNull(notifications.readAt),
        ),
      )
  }

  async markAllRead(tenantId: number, actorId: number): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientActorId, actorId),
          isNull(notifications.readAt),
        ),
      )
  }

  async listPrefs(tenantId: number, actorIds: readonly number[]): Promise<Map<number, PrefRow[]>> {
    if (actorIds.length === 0) return new Map()
    const rows = await this.db
      .select({
        actorId: notificationPrefs.actorId,
        scope: notificationPrefs.scope,
        scopeId: notificationPrefs.scopeId,
        level: notificationPrefs.level,
        customEvents: notificationPrefs.customEvents,
      })
      .from(notificationPrefs)
      .where(
        and(
          eq(notificationPrefs.tenantId, tenantId),
          inArray(notificationPrefs.actorId, [...actorIds]),
        ),
      )
    const map = new Map<number, PrefRow[]>()
    for (const r of rows) {
      const list = map.get(r.actorId) ?? []
      list.push({
        scope: r.scope,
        scopeId: r.scopeId,
        level: r.level,
        customEvents: Array.isArray(r.customEvents) ? (r.customEvents as string[]) : null,
      })
      map.set(r.actorId, list)
    }
    return map
  }

  async setPref(input: {
    tenantId: number
    actorId: number
    scope: string
    scopeId: number | null
    level: NotificationLevel
    customEvents: readonly string[] | null
  }): Promise<void> {
    await this.db
      .insert(notificationPrefs)
      .values({
        tenantId: input.tenantId,
        actorId: input.actorId,
        scope: input.scope,
        scopeId: input.scopeId,
        level: input.level,
        customEvents: input.customEvents === null ? null : [...input.customEvents],
      })
      .onConflictDoUpdate({
        target: [
          notificationPrefs.tenantId,
          notificationPrefs.actorId,
          notificationPrefs.scope,
          notificationPrefs.scopeId,
        ],
        set: {
          level: input.level,
          customEvents: input.customEvents === null ? null : [...input.customEvents],
          updatedAt: new Date(),
        },
      })
  }

  /* 缺列 = 全部預設(啟用 + 站內 + Email)→ 既有使用者零遷移。 */
  async listSettings(
    tenantId: number,
    actorIds: readonly number[],
  ): Promise<Map<number, { enabled: boolean; channels: Record<string, string[]> | null }>> {
    const map = new Map<number, { enabled: boolean; channels: Record<string, string[]> | null }>()
    if (actorIds.length === 0) return map
    const rows = await this.db
      .select({
        actorId: notificationSettings.actorId,
        enabled: notificationSettings.enabled,
        channels: notificationSettings.channels,
      })
      .from(notificationSettings)
      .where(
        and(
          eq(notificationSettings.tenantId, tenantId),
          inArray(notificationSettings.actorId, [...actorIds]),
        ),
      )
    for (const r of rows) {
      map.set(r.actorId, {
        enabled: r.enabled,
        channels: (r.channels as Record<string, string[]> | null) ?? null,
      })
    }
    return map
  }

  async setSettings(input: {
    tenantId: number
    actorId: number
    enabled: boolean
    channels: Record<string, string[]> | null
  }): Promise<void> {
    await this.db
      .insert(notificationSettings)
      .values(input)
      .onConflictDoUpdate({
        target: [notificationSettings.tenantId, notificationSettings.actorId],
        set: { enabled: input.enabled, channels: input.channels, updatedAt: new Date() },
      })
  }

  async defaultLevel(): Promise<NotificationLevel> {
    return DEFAULT_LEVEL
  }
}
