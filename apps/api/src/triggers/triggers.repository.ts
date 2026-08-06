import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"

import type { FormatCondition } from "@weyver/rules"
import { TenantDb } from "../db/db.module.js"
import { triggerDefs, triggerRuns } from "../db/schema.js"
import type { TriggerConfig, TriggerOutcome } from "./trigger-specs.js"

export interface TriggerRow {
  readonly id: number
  readonly formId: number
  readonly name: string
  readonly onCreate: boolean
  readonly onUpdate: boolean
  readonly watchFields: readonly string[]
  readonly conditions: readonly FormatCondition[]
  readonly config: TriggerConfig
  readonly position: number
  readonly enabled: boolean
}

export interface TriggerRunRow {
  readonly id: number
  readonly triggerId: number
  readonly triggerName: string
  readonly recordId: number
  readonly outcome: TriggerOutcome
  readonly detail: Record<string, unknown> | null
  readonly createdAt: Date
}

/* 🔴 走 `TenantDb`(= `APP_DRIZZLE` app 車道)而**不是** `DRIZZLE`。

   `DRIZZLE` 是**特權車道**,RLS 不執法 —— 用它的話 `0055` 那些 RLS policy 與
   `GRANT` 全都是裝飾,租戶隔離只剩 where 子句這一道,而 where 子句會被漏寫。
   本 repo 已為「特權連線遮蔽安全機制」付過五次代價。

   `TenantDb.withTenant` 連裸 db 都拿不到,漏設租戶語境的查詢**寫不出來**。

   ⚠️ 鄰居 `actions.repository.ts` 用的是 `DRIZZLE` —— 那是既有狀態,
   不是本模組要照抄的範本。新寫的東西走強的那條。

   ⚠️ where 裡仍留 `tenant_id` 比對:RLS 是兜底不是唯一一道,
   而且留著的話「拿掉 RLS 會怎樣」在測試裡看得出來。 */
@Injectable()
export class TriggersRepository {
  constructor(@Inject(TenantDb) private readonly tdb: TenantDb) {}

  async listByForm(tenantId: number, formId: number): Promise<TriggerRow[]> {
    return this.tdb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(triggerDefs)
        .where(
          and(
            eq(triggerDefs.tenantId, tenantId),
            eq(triggerDefs.formId, formId),
            isNull(triggerDefs.deletedAt),
          ),
        )
        .orderBy(asc(triggerDefs.position), asc(triggerDefs.id))
      return rows.map(toRow)
    })
  }

  /* 同步側要的:啟用中 + 時機對 + `updateSelf`。

     🔴 動作型別的過濾放在**查詢**裡而不是迴圈裡 —— 同步側每次存檔都會跑,
     把整張表的觸發器撈回來再丟掉一半是白費的 I/O。 */
  async listActiveSync(tenantId: number, formId: number, isCreate: boolean): Promise<TriggerRow[]> {
    return this.tdb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(triggerDefs)
        .where(
          and(
            eq(triggerDefs.tenantId, tenantId),
            eq(triggerDefs.formId, formId),
            isNull(triggerDefs.deletedAt),
            eq(triggerDefs.enabled, true),
            eq(triggerDefs.actionType, "updateSelf"),
            eq(isCreate ? triggerDefs.onCreate : triggerDefs.onUpdate, true),
          ),
        )
        .orderBy(asc(triggerDefs.position), asc(triggerDefs.id))
      return rows.map(toRow)
    })
  }

  async get(tenantId: number, triggerId: number): Promise<TriggerRow | null> {
    return this.tdb.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(triggerDefs)
        .where(
          and(
            eq(triggerDefs.tenantId, tenantId),
            eq(triggerDefs.id, triggerId),
            isNull(triggerDefs.deletedAt),
          ),
        )
        .limit(1)
      return row === undefined ? null : toRow(row)
    })
  }

  async create(input: {
    readonly tenantId: number
    readonly formId: number
    readonly name: string
    readonly onCreate: boolean
    readonly onUpdate: boolean
    readonly watchFields: readonly string[]
    readonly conditions: readonly FormatCondition[]
    readonly config: TriggerConfig
    readonly enabled: boolean
  }): Promise<number> {
    return this.tdb.withTenant(input.tenantId, async (tx) => {
      const [row] = await tx
        .insert(triggerDefs)
        .values({
          tenantId: input.tenantId,
          formId: input.formId,
          name: input.name,
          onCreate: input.onCreate,
          onUpdate: input.onUpdate,
          watchFields: [...input.watchFields],
          conditions: [...input.conditions],
          actionType: input.config.actionType,
          config: input.config,
          enabled: input.enabled,
          position: sql`(SELECT COALESCE(MAX(position), -1) + 1 FROM trigger_def
                          WHERE tenant_id = ${input.tenantId} AND form_id = ${input.formId})`,
        })
        .returning({ id: triggerDefs.id })
      return row?.id ?? 0
    })
  }

  async update(tenantId: number, triggerId: number, patch: Record<string, unknown>): Promise<void> {
    if (Object.keys(patch).length === 0) return
    await this.tdb.withTenant(tenantId, async (tx) => {
      await tx
        .update(triggerDefs)
        .set(patch)
        .where(and(eq(triggerDefs.tenantId, tenantId), eq(triggerDefs.id, triggerId)))
    })
  }

  async softDelete(tenantId: number, triggerId: number): Promise<void> {
    await this.tdb.withTenant(tenantId, async (tx) => {
      await tx
        .update(triggerDefs)
        .set({ deletedAt: new Date() })
        .where(and(eq(triggerDefs.tenantId, tenantId), eq(triggerDefs.id, triggerId)))
    })
  }

  async recordRun(input: {
    readonly tenantId: number
    readonly triggerId: number
    readonly formId: number
    readonly recordId: number
    readonly actorId: number | null
    readonly outcome: TriggerOutcome
    readonly detail?: Record<string, unknown>
  }): Promise<void> {
    await this.tdb.withTenant(input.tenantId, async (tx) => {
      await tx.insert(triggerRuns).values({
        tenantId: input.tenantId,
        triggerId: input.triggerId,
        formId: input.formId,
        recordId: input.recordId,
        actorId: input.actorId,
        outcome: input.outcome,
        detail: input.detail ?? null,
      })
    })
  }

  async listRuns(tenantId: number, formId: number, limit: number): Promise<TriggerRunRow[]> {
    return this.tdb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: triggerRuns.id,
          triggerId: triggerRuns.triggerId,
          triggerName: triggerDefs.name,
          recordId: triggerRuns.recordId,
          outcome: triggerRuns.outcome,
          detail: triggerRuns.detail,
          createdAt: triggerRuns.createdAt,
        })
        .from(triggerRuns)
        .innerJoin(triggerDefs, eq(triggerDefs.id, triggerRuns.triggerId))
        .where(and(eq(triggerRuns.tenantId, tenantId), eq(triggerRuns.formId, formId)))
        .orderBy(desc(triggerRuns.id))
        .limit(limit)
      return rows.map((r) => ({
        ...r,
        outcome: r.outcome as TriggerOutcome,
        detail: r.detail as Record<string, unknown> | null,
      }))
    })
  }
}

function toRow(row: typeof triggerDefs.$inferSelect): TriggerRow {
  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    onCreate: row.onCreate,
    onUpdate: row.onUpdate,
    watchFields: row.watchFields as string[],
    conditions: row.conditions as FormatCondition[],
    config: row.config as TriggerConfig,
    position: row.position,
    enabled: row.enabled,
  }
}
