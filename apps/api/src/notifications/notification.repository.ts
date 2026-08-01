import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import {
  notificationDeliveries,
  notificationPrefs,
  notificationSettings,
  notifications,
} from "../db/schema.js"
import { emailDelayMinutes } from "./notification-dispatcher.service.js"
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
  /* 🔴 與 `broadcastChannel` **恰有其一**(DB CHECK 執法)。
     個人通知有收件人;群組廣播沒有 —— 它送往一個頻道,不是一個人。 */
  readonly recipientActorId: number | null
  /* 🔴 **不可為 optional**:drizzle 的多列 insert 以**第一列**決定欄位集合,
     若個人列沒有這個鍵而廣播列有,後續列的值會整組位移
     (實測症狀是 `null value in column "event"`,完全看不出真因)。
     一律帶上、個人列填 null,讓所有列同形。 */
  readonly broadcastChannel: string | null
  readonly event: string
  readonly formId: number | null
  readonly recordId: number | null
  readonly title: string
  readonly actorId: number | null
  /* 通道**逐人決定**(每個使用者的通道偏好不同),不是整批共用 */
  readonly channels: readonly string[]
}

const keyOf = (actorId: number | null, broadcast: string | null, event: string): string =>
  `${actorId === null ? `ch:${broadcast ?? ""}` : String(actorId)}:${event}`

@Injectable()
export class NotificationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /* 批次插入 + 對應通道 delivery。**通知與寄送分兩張表**(§0.4.2)。 */
  async createMany(rows: readonly NewNotification[]): Promise<number> {
    if (rows.length === 0) return 0
    /* 一併 RETURNING event 與收件人 —— **不依賴 INSERT ... RETURNING 的列序**
       與輸入陣列對齊(PG 未形式保證) */
    const inserted = await this.db
      .insert(notifications)
      .values(rows.map(({ channels: _c, ...r }) => r))
      .returning({
        id: notifications.id,
        tenantId: notifications.tenantId,
        event: notifications.event,
        recipientActorId: notifications.recipientActorId,
        broadcastChannel: notifications.broadcastChannel,
      })
    /* 🔴 key 必須含廣播通道。原本只有 `收件人:事件` —— 廣播列的收件人皆為 null,
       同一事件送往兩個通道會**撞在同一個 key 上**,其中一個的通道設定被覆蓋。 */
    const channelsOf = new Map(
      rows.map((r) => [keyOf(r.recipientActorId, r.broadcastChannel ?? null, r.event), r.channels]),
    )
    /* email 之派送時刻依事件分流:簽核類立即,一般資料異動等去抖動視窗
       (OQ-NT-8:一筆記錄連續編輯 10 次不該是 10 封信)。
       時刻以 **DB 的 now()** 計算,不用應用時鐘(見 emailDelayMinutes 註解)。 */
    const deliveries = inserted.flatMap((n) =>
      (channelsOf.get(keyOf(n.recipientActorId, n.broadcastChannel, n.event)) ?? ["inapp"]).map(
        (channel) => ({
          tenantId: n.tenantId,
          notificationId: n.id,
          channel,
          ...(channel === "email"
            ? {
                nextAttemptAt: sql`now() + make_interval(mins => ${emailDelayMinutes(n.event)})`,
              }
            : {}),
        }),
      ),
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
      .where(and(eq(notifications.tenantId, tenantId), eq(notifications.recipientActorId, actorId)))
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
        /* 0 為「無特定資源」之哨兵,對外仍以 null 表達 */
        scopeId: r.scopeId === 0 ? null : r.scopeId,
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
        scopeId: input.scopeId ?? 0,
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
