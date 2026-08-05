import { Inject, Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"
import { DDL_KNEX } from "../../db/db.module.js"
import { SearchIndexService } from "../../search/search-index.service.js"
import { DATA_SCHEMA, physicalColumnName, physicalTableName } from "../identifiers.js"
import { TRASH_RETENTION_DAYS } from "./trash.service.js"

/* 🔴 H-2 M3|保留期到期硬刪。**這是本模組真正的合規部分。**

   在此之前,本專案所有刪除都只是 `deleted_at = now()`,而 `dropField` / `dropForm` 的
   註解寫著「物理欄/表保留(清理 job 之後收)」—— **那個 job 從來沒有存在過**。
   個資法 §11 III 與 GDPR 都要求「期限屆滿即刪除」;EDPB 2025 協調執法報告
   (32 個 DPA)明確把「無成文刪除程序、僅靠覆寫週期」列為不足。
   永不硬刪 = 法律上沒刪。

   **為什麼直接掃 `deleted_at` 而不是掃 `trash_entry`**|entry 是使用者介面的索引,
   可能因為任何原因缺漏(舊資料、bug、未接上的刪除路徑)。合規不能有死角,
   所以真實驅動來源是各表自己的 `deleted_at`;掃到時順手把對應 entry 結案。

   **批次 + lock_timeout**|Baserow 的 `PermanentDeletionMaxLocksExceededException`
   是真實踩過的坑:一次刪太多會撞 `max_locks_per_transaction`。 */

const BATCH_LIMIT = 200
/* DDL(DROP TABLE / DROP COLUMN)拿不到鎖就跳過,下輪再試 —— 絕不排隊卡住線上流量 */
const PURGE_LOCK_TIMEOUT = "3s"
const PURGE_STATEMENT_TIMEOUT = "60s"
const PURGE_LOCK_KEY = 909_002

/* 修改紀錄的保留期。**比回收桶長** —— 回收桶留「可能要救回來的東西」,
   修改紀錄留「查帳用的事實」,後者的價值衰減得慢。一年對齊年度盤點與稽核週期。 */
export const REVISION_RETENTION_DAYS = 365

/* 7 個 Tier-1 `deleted_at` 實體。漏一個就是合規破口留在角落(FMEA R6),
   所以列成表而不是散在各處 if。`view_def` 等純 metadata 直接 DELETE。 */
const TIER1_TABLES = [
  "view_def",
  "label_def",
  "button_def",
  "approval_def",
  "relation_def",
] as const

export interface PurgeResult {
  readonly records: number
  readonly fields: number
  readonly forms: number
  readonly metadata: number
  /* R1·H-4|逾期的記錄修改紀錄 */
  readonly revisions: number
  readonly skipped: boolean
}

@Injectable()
export class TrashPurgeService {
  private readonly logger = new Logger(TrashPurgeService.name)

  constructor(
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(ConfigService) private readonly config: ConfigService,
    /* H-3|表整張硬刪時一併清搜尋索引。非 optional —— 漏掉就是 `search_doc` 無限長大,
       而且是那種沒人會注意到的長大。 */
    @Inject(SearchIndexService) private readonly searchIndex: SearchIndexService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: "trash.purge" })
  async scheduled(): Promise<void> {
    try {
      const result = await this.run()
      if (!result.skipped) this.logger.log(`trash purge: ${JSON.stringify(result)}`)
    } catch (error) {
      this.logger.error(
        `trash purge failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private get dryRun(): boolean {
    return this.config.get<string>("CLEANUP_DRY_RUN") === "1"
  }

  private get cutoffSql(): string {
    return `now() - interval '${String(TRASH_RETENTION_DAYS)} days'`
  }

  /* 跨租戶維運 → 特權車道。advisory lock 擋多實例重複執行。
     每一類各自一個 tx:一類失敗不拖垮其他類(且避免單一巨大 tx 撞鎖上限)。 */
  async run(): Promise<PurgeResult> {
    const gate = await this.knex.raw<{ rows: { locked: boolean }[] }>(
      "SELECT pg_try_advisory_lock(?) AS locked",
      [PURGE_LOCK_KEY],
    )
    if (gate.rows[0]?.locked !== true) {
      return { records: 0, fields: 0, forms: 0, metadata: 0, revisions: 0, skipped: true }
    }
    try {
      return {
        records: await this.purgeRecords(),
        fields: await this.purgeFields(),
        forms: await this.purgeForms(),
        metadata: await this.purgeTier1Metadata(),
        revisions: await this.purgeRevisions(),
        skipped: false,
      }
    } finally {
      await this.knex.raw("SELECT pg_advisory_unlock(?)", [PURGE_LOCK_KEY])
    }
  }

  /* 🔴 R1·H-4|逾期的記錄修改紀錄。

     `record-revisions.md` FMEA V4 逐字寫著這**不是可選項**:
     一張高頻表一年可以到數百萬列,而那張表只增不改。

     ⚠️ **掛進既有的 `trash.purge` 而不是另開一個排程** ——
     同一個維運動作在不同檔案裡有兩套做法本身就是缺陷(audit-E §3-4 才剛記過),
     而且它已經有 advisory lock 與「一類失敗不拖垮其他類」的形狀。

     ⚠️ **保留期比回收桶長**:回收桶留的是「可能要救回來的東西」,
     修改紀錄留的是「查帳用的事實」—— 後者的價值隨時間衰減得慢得多。
     一年是相對於稽核與年度盤點的常見週期。 */
  async purgeRevisions(): Promise<number> {
    if (this.dryRun) return 0
    const res = await this.knex.raw<{ rowCount?: number }>(
      `DELETE FROM record_revision WHERE created_at < now() - interval '${String(REVISION_RETENTION_DAYS)} days'`,
    )
    return res.rowCount ?? 0
  }

  /* 逾期的軟刪記錄 → 真 DELETE。
     🔴 **簽核中 / 已完成簽核的記錄排除**(AGENTS 鐵則 4:過帳後不可刪改)。
     這類記錄即使逾期也不刪,寧可留著讓人工判斷 —— 誤刪一張已核准的單據不可回復。 */
  async purgeRecords(): Promise<number> {
    const tables = await this.liveDataTables()
    let total = 0
    for (const { table, formId } of tables) {
      const deleted = await this.knex.transaction(async (trx) => {
        await trx.raw(`SET LOCAL lock_timeout = '${PURGE_LOCK_TIMEOUT}'`)
        await trx.raw(`SET LOCAL statement_timeout = '${PURGE_STATEMENT_TIMEOUT}'`)
        const victims = await trx
          .withSchema(DATA_SCHEMA)
          .table(table)
          .whereNotNull("deleted_at")
          .whereRaw(`deleted_at < ${this.cutoffSql}`)
          .whereNotIn(
            "id",
            trx
              .table("approval_instance")
              .select("record_id")
              .where("form_id", formId)
              .whereIn("status", ["pending", "approved"]),
          )
          .limit(BATCH_LIMIT)
          .pluck<number[]>("id")
        if (victims.length === 0 || this.dryRun) return victims.length

        await trx.withSchema(DATA_SCHEMA).table(table).whereIn("id", victims).delete()
        /* H-3|搜尋索引一起清。保留期**內**不清 —— 還原時索引原封不動,不必重建。
           form_id 為全域序號故無跨租戶歧義。 */
        await trx("search_doc").where({ form_id: formId }).whereIn("record_id", victims).delete()
        await trx("trash_entry")
          .where({ resource_type: "record", state: "trashed", form_id: formId })
          .whereIn("resource_id", victims)
          .update({ state: "purged", resolved_at: trx.fn.now() })
        await this.orphanFiles(trx, (q) =>
          q.where({ form_id: formId }).whereIn("record_id", victims),
        )
        return victims.length
      })
      total += deleted
    }
    return total
  }

  /* 逾期的軟刪欄位 → 真 `DROP COLUMN`。
     🔴 這一步是唯一能回收儲存的動作,但 **回收不到 attnum**:本機實測 300 次 add/drop
     後 `VACUUM FULL`,`pg_attribute` 的 dropped 仍是 300、max_attnum 仍是 301。
     PG 核心開發者於 pgsql-hackers 明言「We just never recycle attnums」。
     所以 1,600 欄是**該表一生的加總上限**,不是同時存在的上限(docs §0.5)。 */
  async purgeFields(): Promise<number> {
    const rows = await this.knex
      .table("field_def")
      .whereNotNull("deleted_at")
      .whereRaw(`deleted_at < ${this.cutoffSql}`)
      .limit(BATCH_LIMIT)
      .select<{ id: number | string; form_id: number | string; tenant_id: number | string }[]>(
        "id",
        "form_id",
        "tenant_id",
      )
    if (rows.length === 0 || this.dryRun) return rows.length

    let done = 0
    for (const row of rows) {
      const fieldId = Number(row.id)
      const formId = Number(row.form_id)
      try {
        await this.knex.transaction(async (trx) => {
          await trx.raw(`SET LOCAL lock_timeout = '${PURGE_LOCK_TIMEOUT}'`)
          await trx.raw(`SET LOCAL statement_timeout = '${PURGE_STATEMENT_TIMEOUT}'`)
          // 與其他 DDL 同一把 per-form advisory lock:不與建欄/改型別互踩
          await trx.raw("SELECT pg_advisory_xact_lock(?)", [formId])
          await trx.raw("ALTER TABLE ??.?? DROP COLUMN IF EXISTS ??", [
            DATA_SCHEMA,
            physicalTableName(formId),
            physicalColumnName(fieldId),
          ])
          await trx("field_def").where({ id: fieldId }).delete()
          await trx("trash_entry")
            .where({ resource_type: "field", resource_id: fieldId, state: "trashed" })
            .update({ state: "purged", resolved_at: trx.fn.now() })
          await this.orphanFiles(trx, (q) => q.where({ field_id: fieldId }))
          await trx("ddl_audit").insert({
            tenant_id: Number(row.tenant_id),
            form_id: formId,
            action: "purgeField",
            spec: JSON.stringify({ fieldId, retentionDays: TRASH_RETENTION_DAYS }),
            result: "ok",
          })
        })
        done += 1
      } catch (error) {
        // 拿不到鎖 / 表已不存在 → 跳過,下輪再試。單一欄位失敗不中斷整批
        this.logger.warn(
          `purge field ${String(fieldId)} skipped: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return done
  }

  /* 逾期的軟刪表單 → 真 `DROP TABLE`。
     子表單(parent_form_id 指向本表)還活著就跳過 —— 先刪父表會讓子表的 FK 斷掉。 */
  async purgeForms(): Promise<number> {
    const rows = await this.knex
      .table("form_def as f")
      .whereNotNull("f.deleted_at")
      .whereRaw(`f.deleted_at < ${this.cutoffSql}`)
      .whereNotExists(
        this.knex
          .select(this.knex.raw("1"))
          .from("form_def as c")
          .whereRaw("c.parent_form_id = f.id")
          .whereNull("c.deleted_at"),
      )
      .limit(BATCH_LIMIT)
      .select<{ id: number | string; tenant_id: number | string }[]>("f.id", "f.tenant_id")
    if (rows.length === 0 || this.dryRun) return rows.length

    let done = 0
    for (const row of rows) {
      const formId = Number(row.id)
      try {
        await this.knex.transaction(async (trx) => {
          await trx.raw(`SET LOCAL lock_timeout = '${PURGE_LOCK_TIMEOUT}'`)
          await trx.raw(`SET LOCAL statement_timeout = '${PURGE_STATEMENT_TIMEOUT}'`)
          await trx.raw("SELECT pg_advisory_xact_lock(?)", [formId])
          await trx.raw("DROP TABLE IF EXISTS ??.??", [DATA_SCHEMA, physicalTableName(formId)])
          await this.searchIndex.removeFormInTx(trx, Number(row.tenant_id), formId)
          await trx("field_def").where({ form_id: formId }).delete()
          await trx("view_def").where({ form_id: formId }).delete()
          await trx("form_def").where({ id: formId }).delete()
          await this.orphanFiles(trx, (q) => q.where({ form_id: formId }))
          await trx("trash_entry")
            .where({ state: "trashed" })
            .where(function () {
              this.where({ resource_type: "form", resource_id: formId }).orWhere({
                form_id: formId,
              })
            })
            .update({ state: "purged", resolved_at: trx.fn.now() })
          await trx("ddl_audit").insert({
            tenant_id: Number(row.tenant_id),
            form_id: formId,
            action: "purgeForm",
            spec: JSON.stringify({ retentionDays: TRASH_RETENTION_DAYS }),
            result: "ok",
          })
        })
        done += 1
      } catch (error) {
        this.logger.warn(
          `purge form ${String(formId)} skipped: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return done
  }

  /* 🔴 R8|硬刪時把附件交棒給孤兒回收器。

     在此之前,記錄 / 欄位 / 表單真的被 DELETE 之後,`file_object` 仍是 `bound`,
     而 `CleanupService.reclaimOrphanedFiles` 只撿 `orphaned` —— 於是檔案永遠不會被回收:
     **DB 裡查不到、儲存體上還在、額度持續被佔**。對合規而言那等於沒刪。

     **只標狀態,不在這裡刪位元組**:物件刪除不是交易性的,放進 tx 裡一旦回滾
     就是「資料還在、檔案沒了」。交給既有回收器做,順帶拿到它的觀察期、
     縮圖連帶刪、單檔失敗不中斷整批這三件已經寫好的事。
     那條觀察期以 `created_at` 起算,對這些檔案早就過了 —— 30 天的保留期已經是觀察期。 */
  private async orphanFiles(
    trx: Knex,
    scope: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
  ): Promise<void> {
    const exists = await trx.raw<{ rows: { ok: boolean }[] }>(
      "SELECT to_regclass('public.file_object') IS NOT NULL AS ok",
    )
    if (exists.rows[0]?.ok !== true) return
    await scope(trx("file_object").whereNull("deleted_at").whereNot("status", "orphaned")).update({
      status: "orphaned",
    })
  }

  /* 其餘 Tier-1 metadata:純資料列,直接 DELETE。 */
  async purgeTier1Metadata(): Promise<number> {
    let total = 0
    for (const table of TIER1_TABLES) {
      const exists = await this.knex.raw<{ rows: { ok: boolean }[] }>(
        "SELECT to_regclass(?) IS NOT NULL AS ok",
        [`public.${table}`],
      )
      if (exists.rows[0]?.ok !== true) continue
      const hasDeletedAt = await this.knex.raw<{ rows: { ok: boolean }[] }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=? AND column_name='deleted_at') AS ok",
        [table],
      )
      if (hasDeletedAt.rows[0]?.ok !== true) continue

      if (this.dryRun) {
        const counted = await this.knex
          .table(table)
          .whereNotNull("deleted_at")
          .whereRaw(`deleted_at < ${this.cutoffSql}`)
          .count({ total: "*" })
        total += Number((counted[0] as { total?: string | number } | undefined)?.total ?? 0)
        continue
      }
      total += await this.knex
        .table(table)
        .whereNotNull("deleted_at")
        .whereRaw(`deleted_at < ${this.cutoffSql}`)
        .limit(BATCH_LIMIT)
        .delete()
    }
    return total
  }

  /* 只掃已 provision 且未軟刪的表 —— 已軟刪的表整張由 purgeForms 處理。 */
  private async liveDataTables(): Promise<readonly { table: string; formId: number }[]> {
    const rows = await this.knex
      .table("form_def")
      .where("provision_state", "ready")
      .whereNull("deleted_at")
      .select<{ id: number | string }[]>("id")
    return rows.map((r) => ({ table: physicalTableName(Number(r.id)), formId: Number(r.id) }))
  }
}
