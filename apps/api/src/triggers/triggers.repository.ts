import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"

import type { FormatCondition } from "@weyver/rules"
import { TenantDb } from "../db/db.module.js"
import { fieldDefs, triggerDefs, triggerRuns } from "../db/schema.js"
import type { TriggerConfig, TriggerOutcome } from "./trigger-specs.js"

/* 已發布的定義快照。**runtime 只吃這個形狀。** */
export interface PublishedDef {
  readonly onCreate: boolean
  readonly onUpdate: boolean
  readonly watchFields: readonly string[]
  readonly conditions: readonly FormatCondition[]
  readonly actionType: TriggerConfig["actionType"]
  readonly config: TriggerConfig
}

export interface TriggerRow {
  readonly id: number
  readonly formId: number
  readonly name: string
  readonly onCreate: boolean
  readonly onUpdate: boolean
  readonly watchFields: readonly string[]
  readonly conditions: readonly FormatCondition[]
  readonly config: TriggerConfig
  readonly schedule: { freq: string; hour: number; day: number | null } | null
  readonly lastRunAt: Date | null
  readonly createdBy: number | null
  readonly position: number
  readonly enabled: boolean
  /* `null` = 從未發布 → 這條觸發器**不會跑**。 */
  readonly published: PublishedDef | null
  /* 設計器編輯中的版本(平鋪欄位的原值)。 */
  readonly draft: PublishedDef
  readonly hasUnpublishedChanges: boolean
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
  /* 🔴 **runtime 專用:一律讀 `published`,不讀草稿。**

     過濾條件全部打在 jsonb 上而不是那幾個平鋪欄位 —— 那些是草稿。
     用草稿欄位過濾會出現「草稿說是 updateSelf、已發布的其實是 pushTo」
     這種撈到卻執行不了的列。**同一個真相只讀一個地方。** */
  async listActiveSync(tenantId: number, formId: number, isCreate: boolean): Promise<TriggerRow[]> {
    const timing = isCreate ? "onCreate" : "onUpdate"
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
            sql`${triggerDefs.published} IS NOT NULL`,
            sql`${triggerDefs.published} ->> 'actionType' = 'updateSelf'`,
            sql`(${triggerDefs.published} -> ${timing})::boolean IS TRUE`,
          ),
        )
        .orderBy(asc(triggerDefs.position), asc(triggerDefs.id))
      return rows.map(toRow)
    })
  }

  /* 把草稿複製成已發布。**這是唯一讓定義變更生效的動作。** */
  async publish(tenantId: number, triggerId: number): Promise<void> {
    await this.tdb.withTenant(tenantId, async (tx) => {
      await tx
        .update(triggerDefs)
        .set({
          published: sql`jsonb_build_object(
            'onCreate', ${triggerDefs.onCreate},
            'onUpdate', ${triggerDefs.onUpdate},
            'watchFields', ${triggerDefs.watchFields},
            'conditions', ${triggerDefs.conditions},
            'actionType', ${triggerDefs.actionType},
            'config', ${triggerDefs.config})`,
        })
        .where(and(eq(triggerDefs.tenantId, tenantId), eq(triggerDefs.id, triggerId)))
    })
  }

  /* 丟掉草稿,回到已發布的版本。 */
  async discardDraft(tenantId: number, triggerId: number): Promise<void> {
    await this.tdb.withTenant(tenantId, async (tx) => {
      await tx
        .update(triggerDefs)
        .set({
          onCreate: sql`(${triggerDefs.published} -> 'onCreate')::boolean`,
          onUpdate: sql`(${triggerDefs.published} -> 'onUpdate')::boolean`,
          watchFields: sql`${triggerDefs.published} -> 'watchFields'`,
          conditions: sql`${triggerDefs.published} -> 'conditions'`,
          actionType: sql`${triggerDefs.published} ->> 'actionType'`,
          config: sql`${triggerDefs.published} -> 'config'`,
        })
        .where(
          and(
            eq(triggerDefs.tenantId, tenantId),
            eq(triggerDefs.id, triggerId),
            sql`${triggerDefs.published} IS NOT NULL`,
          ),
        )
    })
  }

  /* 🔴 表單目前**實際有的**欄位名(FMEA T2 用)。

     刻意在這裡查而不是注入 `MetadataService` —— 後者住在 `FormEngineModule`,
     而那個模組注入 `TriggerSyncService`,反過來相依就是模組級迴圈。
     這裡只要欄名一個清單,走同一條 app 車道即可。 */
  async listFieldNames(tenantId: number, formId: number): Promise<string[]> {
    return this.tdb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ name: fieldDefs.name })
        .from(fieldDefs)
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.formId, formId),
            isNull(fieldDefs.deletedAt),
          ),
        )
      return rows.map((r) => r.name)
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
    readonly schedule?:
      | { readonly freq: string; readonly hour: number; readonly day?: number | undefined }
      | undefined
    /* 🔴 定時觸發以建立者的身分執行,故建立當下就要記住是誰。 */
    readonly createdBy: number
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
          createdBy: input.createdBy,
          onSchedule: input.schedule !== undefined,
          scheduleFreq: input.schedule?.freq ?? null,
          scheduleHour: input.schedule?.hour ?? null,
          scheduleDay: input.schedule?.day ?? null,
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

/* 🔴 比對草稿與已發布**不能用 `JSON.stringify`**。

   `published` 是 jsonb,而 Postgres 的 jsonb **會重排物件的鍵**
   (依鍵長度再字典序),所以剛發布完的兩份內容相同、字串卻不同 ——
   結果是「發布了但永遠顯示有未發布的變更」。
   第一版就是這樣寫的,兩條測試同時紅在 `expected true to be false`。

   遞迴排序鍵後再序列化。**陣列不排序**:條件的順序有語意(由上而下、後者覆蓋)。 */
function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm)
    if (x !== null && typeof x === "object") {
      const o = x as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .map((k) => [k, norm(o[k])]),
      )
    }
    return x
  }
  return JSON.stringify(norm(v))
}

function toRow(row: typeof triggerDefs.$inferSelect): TriggerRow {
  const published = (row.published ?? null) as PublishedDef | null
  const draft: PublishedDef = {
    onCreate: row.onCreate,
    onUpdate: row.onUpdate,
    watchFields: row.watchFields as string[],
    conditions: row.conditions as FormatCondition[],
    actionType: row.actionType as TriggerConfig["actionType"],
    config: row.config as TriggerConfig,
  }
  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    /* 🔴 平鋪欄位一律回**已發布的值**(沒發布過才回草稿)。

       `listActiveSync` 回來的列也會經過這裡 —— 若這裡回草稿,
       同步側就會拿草稿去執行,整個分離等於沒做。
       設計器要編輯的草稿走 `draft`,兩者刻意分名不共用。 */
    onCreate: published?.onCreate ?? draft.onCreate,
    onUpdate: published?.onUpdate ?? draft.onUpdate,
    watchFields: published?.watchFields ?? draft.watchFields,
    conditions: published?.conditions ?? draft.conditions,
    config: published?.config ?? draft.config,
    /* 排程**不進草稿** —— 與 `enabled` 同理由:它是「什麼時候跑」不是「跑什麼」,
       改了時間還要按發布才生效是反直覺的。 */
    schedule:
      row.onSchedule && row.scheduleFreq !== null && row.scheduleHour !== null
        ? { freq: row.scheduleFreq, hour: row.scheduleHour, day: row.scheduleDay }
        : null,
    lastRunAt: row.lastRunAt,
    createdBy: row.createdBy,
    draft,
    position: row.position,
    enabled: row.enabled,
    published,
    hasUnpublishedChanges: published !== null && canonical(published) !== canonical(draft),
  }
}
