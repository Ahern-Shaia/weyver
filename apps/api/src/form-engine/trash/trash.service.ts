import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../../db/db.module.js"
import { fieldDefs, formDefs, trashEntries } from "../../db/schema.js"

/* H-2 M1/M2|回收桶:寫入 entry、列出、還原(含 dry-run 衝突檢查)。

   **設計前提**|本表是索引不是真實來源(見 schema 註解)。所以:
   - 寫 entry 失敗**不得**讓刪除本身失敗?—— 不。反過來:entry 與刪除**同一 tx**。
     分開寫會出現「東西刪了但回收桶裡沒有」,那正是使用者永遠找不回來的情況。
   - 列表一律走 **app 車道(RLS)**。本 session 已四度踩到「測試/服務用特權連線 →
     權限問題整個被遮住」,回收桶是最容易犯這個錯的地方(「要看到已刪的」很容易
     被誤解成「要繞過限制」)。 */

export const TRASH_RETENTION_DAYS = 30

export type TrashResourceType = "record" | "form" | "field"

export interface TrashEntryRow {
  readonly id: number
  readonly resourceType: TrashResourceType
  readonly resourceId: number
  readonly formId: number | null
  readonly title: string
  readonly deletedBy: number | null
  readonly deletedAt: Date
  readonly purgeAfter: Date
}

/* 還原前的阻擋原因。三類對應 docs §4.2 —— 每一類都必須是「使用者能據以行動」的,
   不是一句 "restore failed"。 */
export type RestoreBlocker =
  | { readonly kind: "parentDeleted"; readonly message: string }
  | { readonly kind: "nameConflict"; readonly message: string; readonly conflictName: string }
  | { readonly kind: "constraintViolation"; readonly message: string; readonly fields: string[] }

export interface RestorePlan {
  readonly entryId: number
  readonly resourceType: TrashResourceType
  readonly title: string
  readonly blockers: readonly RestoreBlocker[]
  /* 連帶還原的資源數(表單 → 欄位) */
  readonly relatedCount: number
}

@Injectable()
export class TrashService {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(DRIZZLE) private readonly privileged: DrizzleDb,
  ) {}

  private purgeAfter(): Date {
    return new Date(Date.now() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  }

  /* 刪除路徑呼叫。**與刪除同一 tx**(呼叫端負責);此處只負責 insert。
     `onConflictDoNothing`:同一資源重複軟刪(不該發生,但競態下可能)不炸,
     保留較早那筆 —— 較早的 purge_after 較早到期,對合規是保守的一邊。 */
  async record(
    tx: DrizzleDb,
    input: {
      tenantId: number
      resourceType: TrashResourceType
      resourceId: number
      formId: number | null
      title: string
      relatedIds?: readonly number[]
      deletedBy: number | null
      detail?: Record<string, unknown>
    },
  ): Promise<void> {
    await tx
      .insert(trashEntries)
      .values({
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        formId: input.formId,
        title: input.title,
        relatedIds: [...(input.relatedIds ?? [])],
        detail: input.detail ?? {},
        deletedBy: input.deletedBy,
        purgeAfter: this.purgeAfter(),
      })
      .onConflictDoNothing()
  }

  /* 呼叫端已在自己的 tx 之外時用這個(自帶 app 車道 tx)。 */
  async recordStandalone(input: {
    tenantId: number
    resourceType: TrashResourceType
    resourceId: number
    formId: number | null
    title: string
    relatedIds?: readonly number[]
    deletedBy: number | null
  }): Promise<void> {
    await this.tenantDb.withTenant(input.tenantId, (tx) => this.record(tx, input))
  }

  /* 🔴 走 app 車道 → RLS 保證只看得到本租戶。表單級過濾由呼叫端依 EffectivePermissions 再收一層
     (RLS 只管租戶,管不了「這個人能不能看這張表」)。 */
  async list(
    tenantId: number,
    opts: { readonly formIds?: readonly number[]; readonly limit?: number } = {},
  ): Promise<readonly TrashEntryRow[]> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(trashEntries)
        .where(
          and(
            eq(trashEntries.tenantId, tenantId),
            eq(trashEntries.state, "trashed"),
            opts.formIds === undefined
              ? undefined
              : opts.formIds.length === 0
                ? sql`false`
                : inArray(trashEntries.formId, [...opts.formIds]),
          ),
        )
        .orderBy(desc(trashEntries.deletedAt))
        .limit(opts.limit ?? 200),
    )
    return rows.map((r) => ({
      id: r.id,
      resourceType: r.resourceType as TrashResourceType,
      resourceId: r.resourceId,
      formId: r.formId,
      title: r.title,
      deletedBy: r.deletedBy,
      deletedAt: r.deletedAt,
      purgeAfter: r.purgeAfter,
    }))
  }

  async getEntry(
    tenantId: number,
    entryId: number,
  ): Promise<{
    id: number
    resourceType: TrashResourceType
    resourceId: number
    formId: number | null
    title: string
    relatedIds: number[]
  } | null> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(trashEntries)
        .where(
          and(
            eq(trashEntries.tenantId, tenantId),
            eq(trashEntries.id, entryId),
            eq(trashEntries.state, "trashed"),
          ),
        )
        .limit(1),
    )
    const row = rows[0]
    if (row === undefined) return null
    return {
      id: row.id,
      resourceType: row.resourceType as TrashResourceType,
      resourceId: row.resourceId,
      formId: row.formId,
      title: row.title,
      relatedIds: row.relatedIds,
    }
  }

  /* 🔴 還原前 dry-run。partial unique(`… WHERE deleted_at IS NULL`)讓「同名重建後再還原」
     **必然**撞 23505 —— 不先驗就是把一個 500 丟給使用者。三類阻擋見 docs §4.2。 */
  async planRestore(tenantId: number, entryId: number): Promise<RestorePlan | null> {
    const entry = await this.getEntry(tenantId, entryId)
    if (entry === null) return null
    const blockers: RestoreBlocker[] = []

    if (entry.resourceType === "form") {
      const clash = await this.formNameTaken(tenantId, entry.title, entry.resourceId)
      if (clash) {
        blockers.push({
          kind: "nameConflict",
          message: `已有另一張表單叫「${entry.title}」。請先改名或刪除該表單。`,
          conflictName: entry.title,
        })
      }
    }

    if (entry.resourceType === "field" || entry.resourceType === "record") {
      const formId = entry.formId
      if (formId === null) {
        blockers.push({ kind: "parentDeleted", message: "找不到所屬表單。" })
      } else {
        const parentAlive = await this.formAlive(tenantId, formId)
        if (!parentAlive) {
          blockers.push({
            kind: "parentDeleted",
            message: "所屬表單已被刪除。請先還原表單,表單還原時會一併帶回它的欄位與資料。",
          })
        } else if (entry.resourceType === "field") {
          const clash = await this.fieldNameTaken(tenantId, formId, entry.title, entry.resourceId)
          if (clash) {
            blockers.push({
              kind: "nameConflict",
              message: `表單裡已有另一個欄位叫「${entry.title}」。`,
              conflictName: entry.title,
            })
          }
        }
      }
    }

    return {
      entryId: entry.id,
      resourceType: entry.resourceType,
      title: entry.title,
      blockers,
      relatedCount: entry.relatedIds.length,
    }
  }

  /* 還原。**先 plan 再做** —— plan 有阻擋就不動任何東西。
     整批同一 tx:表單 + 當初連帶刪的欄位要嘛都回來、要嘛都不回來。 */
  async restore(
    tenantId: number,
    entryId: number,
    probe?: (formId: number, recordId: number) => Promise<RestoreBlocker[]>,
  ): Promise<{ ok: true } | { ok: false; blockers: readonly RestoreBlocker[] }> {
    const plan = await this.planRestore(tenantId, entryId)
    if (plan === null) return { ok: false, blockers: [{ kind: "parentDeleted", message: "找不到這筆回收項目。" }] }

    const entry = await this.getEntry(tenantId, entryId)
    if (entry === null) return { ok: false, blockers: plan.blockers }

    /* 記錄的「違反後加約束」只有動態表查得出來 → 由呼叫端注入 probe(避免本服務反向依賴 RecordService)。 */
    const extra =
      probe !== undefined && entry.resourceType === "record" && entry.formId !== null
        ? await probe(entry.formId, entry.resourceId)
        : []
    const blockers = [...plan.blockers, ...extra]
    if (blockers.length > 0) return { ok: false, blockers }

    await this.tenantDb.withTenant(tenantId, async (tx) => {
      if (entry.resourceType === "form") {
        await tx
          .update(formDefs)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, entry.resourceId)))
        /* 🔴 只還原**當初連帶刪的**欄位(Baserow related_items)。
           不看 relatedIds 而直接還原該表所有已刪欄位,會把「刪表之前就個別刪掉的欄位」
           一起復活 —— 使用者沒要求那個。 */
        if (entry.relatedIds.length > 0) {
          await tx
            .update(fieldDefs)
            .set({ deletedAt: null })
            .where(
              and(eq(fieldDefs.tenantId, tenantId), inArray(fieldDefs.id, entry.relatedIds)),
            )
        }
      } else if (entry.resourceType === "field") {
        await tx
          .update(fieldDefs)
          .set({ deletedAt: null })
          .where(and(eq(fieldDefs.tenantId, tenantId), eq(fieldDefs.id, entry.resourceId)))
      }
      await tx
        .update(trashEntries)
        .set({ state: "restored", resolvedAt: new Date() })
        .where(and(eq(trashEntries.tenantId, tenantId), eq(trashEntries.id, entryId)))
    })
    return { ok: true }
  }

  /* 記錄的還原走動態表 → 由 RecordService 執行 UPDATE,本服務只結案 entry。 */
  async markRestored(tenantId: number, entryId: number): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(trashEntries)
        .set({ state: "restored", resolvedAt: new Date() })
        .where(and(eq(trashEntries.tenantId, tenantId), eq(trashEntries.id, entryId))),
    )
  }

  async markPurged(tenantId: number, entryId: number): Promise<void> {
    await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .update(trashEntries)
        .set({ state: "purged", resolvedAt: new Date() })
        .where(and(eq(trashEntries.tenantId, tenantId), eq(trashEntries.id, entryId))),
    )
  }

  private async formNameTaken(tenantId: number, name: string, exceptId: number): Promise<boolean> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({ id: formDefs.id })
        .from(formDefs)
        .where(
          and(
            eq(formDefs.tenantId, tenantId),
            eq(formDefs.name, name),
            isNull(formDefs.deletedAt),
            sql`${formDefs.id} <> ${exceptId}`,
          ),
        )
        .limit(1),
    )
    return rows.length > 0
  }

  private async formAlive(tenantId: number, formId: number): Promise<boolean> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({ id: formDefs.id })
        .from(formDefs)
        .where(
          and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId), isNull(formDefs.deletedAt)),
        )
        .limit(1),
    )
    return rows.length > 0
  }

  private async fieldNameTaken(
    tenantId: number,
    formId: number,
    name: string,
    exceptId: number,
  ): Promise<boolean> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({ id: fieldDefs.id })
        .from(fieldDefs)
        .where(
          and(
            eq(fieldDefs.tenantId, tenantId),
            eq(fieldDefs.formId, formId),
            eq(fieldDefs.name, name),
            isNull(fieldDefs.deletedAt),
            sql`${fieldDefs.id} <> ${exceptId}`,
          ),
        )
        .limit(1),
    )
    return rows.length > 0
  }

  /* purge job 用:找出逾期的 entry(跨租戶 → 特權車道,維運作業)。 */
  async expiredEntries(
    limit: number,
  ): Promise<readonly { id: number; tenantId: number; resourceType: string; resourceId: number }[]> {
    return this.privileged
      .select({
        id: trashEntries.id,
        tenantId: trashEntries.tenantId,
        resourceType: trashEntries.resourceType,
        resourceId: trashEntries.resourceId,
      })
      .from(trashEntries)
      .where(and(eq(trashEntries.state, "trashed"), lt(trashEntries.purgeAfter, new Date())))
      .limit(limit)
  }
}
