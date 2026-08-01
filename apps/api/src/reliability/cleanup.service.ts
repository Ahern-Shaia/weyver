import { Inject, Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"
import { DDL_KNEX } from "../db/db.module.js"
import { STORAGE_DRIVER, type StorageDriver, thumbnailKeyOf } from "../storage/storage-driver.js"

/* F-6 M4|排程清理(收斂 core FMEA C2 孤兒 pending form + file-storage S6 孤兒檔實體回收)。

   OQ-REL-4=A:`@nestjs/schedule` 單實例 cron;多實例以 **advisory lock** 擋重複執行(FMEA L7)。
   一律**可重入 + 批次上限 + 結果寫 audit**;任何失敗只告警,不影響主流程(AGENTS:非關鍵路徑)。
   保守時間窗:只清「明確逾時且狀態明確」者,絕不憑推測刪(FMEA L4)。
   `CLEANUP_DRY_RUN=1` → 只統計不刪,供上線前驗證。 */

/* 建表流程 metadata 先寫、DDL 後跑;逾此時數仍 pending = 中途 crash 的孤兒 */
const PENDING_FORM_STALE_HOURS = 24
/* orphaned 檔案再等一段觀察期才實體刪(誤判仍有機會人工救回) */
const ORPHANED_FILE_GRACE_HOURS = 72
const BATCH_LIMIT = 500
/* 同一把鎖 → 多實例只有一個真的跑 */
const CLEANUP_LOCK_KEY = 909_001

export interface CleanupResult {
  readonly staleForms: number
  readonly deletedFiles: number
  readonly expiredIdempotencyKeys: number
  readonly skipped: boolean
}

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name)

  constructor(
    @Inject(DDL_KNEX) private readonly ddlKnex: Knex,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* 🔴 具名不只是為了可讀(F-9 §4.1)。`SchedulerOrchestrator` 對未命名的 cron 用
     `crypto.randomUUID()` 當 key —— **永遠不會撞名**,所以 `ScheduleModule` 若被重複註冊,
     同一個 job 會靜默註冊多份、每次到點跑多次。具名之後第二次註冊即撞名,
     `SchedulerRegistry.addCronJob` 直接拋 DUPLICATE_SCHEDULER → **開機失敗而非靜默重複**。 */
  @Cron(CronExpression.EVERY_HOUR, { name: "reliability.cleanup" })
  async scheduled(): Promise<void> {
    try {
      const result = await this.run()
      if (!result.skipped) this.logger.log(`cleanup: ${JSON.stringify(result)}`)
    } catch (error) {
      // 清理為非關鍵路徑:失敗只告警,主流程不受影響
      this.logger.error(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private get dryRun(): boolean {
    return this.config.get<string>("CLEANUP_DRY_RUN") === "1"
  }

  /* 跨租戶維運作業 → 走特權車道(app 車道之 RLS 只看得到單一租戶)。
     交易範圍 advisory lock:多實例同時觸發時只有一個真的跑,其餘立即 skip(FMEA L7)。
     物件刪除具冪等性(rm force / S3 DeleteObject)→ 極端情況重跑無害。 */
  async run(): Promise<CleanupResult> {
    return this.ddlKnex.transaction(async (trx) => {
      const locked = await trx.raw<{ rows: { locked: boolean }[] }>(
        "SELECT pg_try_advisory_xact_lock(?) AS locked",
        [CLEANUP_LOCK_KEY],
      )
      if (locked.rows[0]?.locked !== true) {
        return { staleForms: 0, deletedFiles: 0, expiredIdempotencyKeys: 0, skipped: true }
      }
      return {
        staleForms: await this.markStalePendingForms(trx),
        deletedFiles: await this.reclaimOrphanedFiles(trx),
        expiredIdempotencyKeys: await this.purgeExpiredIdempotencyKeys(trx),
        skipped: false,
      }
    })
  }

  /* C2|metadata 已寫但物理 DDL 未完成之孤兒:標 failed(不刪 —— 保留供事後查因),寫 ddl_audit。 */
  async markStalePendingForms(trx: Knex): Promise<number> {
    const stale = await trx
      .table("form_def")
      .where("provision_state", "pending")
      .whereRaw(`created_at < now() - interval '${PENDING_FORM_STALE_HOURS} hours'`)
      .limit(BATCH_LIMIT)
      .select<{ id: number | string; tenant_id: number | string }[]>("id", "tenant_id")
    if (stale.length === 0 || this.dryRun) return stale.length

    const ids = stale.map((r) => Number(r.id))
    await trx("form_def").whereIn("id", ids).update({ provision_state: "failed" })
    await trx("ddl_audit").insert(
      stale.map((row) => ({
        tenant_id: Number(row.tenant_id),
        form_id: Number(row.id),
        action: "cleanup_stale_pending",
        spec: JSON.stringify({ staleAfterHours: PENDING_FORM_STALE_HOURS }),
        result: "ok",
      })),
    )
    return ids.length
  }

  /* S6|orphaned 檔案實體回收:先刪物件、再標 deleted_at(順序不可反 —— 反了會產生查不到卻仍佔空間的檔)。
     單檔失敗不中斷整批(可能是儲存端暫時性錯誤,下輪再試)。 */
  async reclaimOrphanedFiles(trx: Knex): Promise<number> {
    const rows = await trx
      .table("file_object")
      .where("status", "orphaned")
      .whereNull("deleted_at")
      .whereRaw(`created_at < now() - interval '${ORPHANED_FILE_GRACE_HOURS} hours'`)
      .limit(BATCH_LIMIT)
      .select<{ key: string }[]>("key")
    if (rows.length === 0 || this.dryRun) return rows.length

    let deleted = 0
    for (const row of rows) {
      try {
        await this.storage.delete(row.key)
        // 縮圖為衍生物、無獨立 metadata 列 → 由 key 推導一併刪(刪不到不算錯:未必存在)
        await this.storage.delete(thumbnailKeyOf(row.key)).catch(() => undefined)
        await trx("file_object").where({ key: row.key }).update({ deleted_at: trx.fn.now() })
        deleted += 1
      } catch (error) {
        this.logger.warn(
          `reclaim file ${row.key} failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return deleted
  }

  /* 冪等 key 逾期即無用(OQ-REL-5 24h);不清會無限成長。 */
  async purgeExpiredIdempotencyKeys(trx: Knex): Promise<number> {
    if (this.dryRun) {
      const rows = await trx("idempotency_key")
        .whereRaw("expires_at < now()")
        .count({ total: "key" })
      const total = (rows[0] as { total?: string | number } | undefined)?.total ?? 0
      return typeof total === "number" ? total : Number(total)
    }
    return trx("idempotency_key").whereRaw("expires_at < now()").delete()
  }
}
