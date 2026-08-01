import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"
import { DDL_KNEX } from "../db/db.module.js"

/* F-8 M2|每日用量快照(OQ-SB-7=A)。

   **為什麼是每日快照而非事件累加**|事件累加要在寫入熱路徑加負擔且需去重;
   每月一次則粒度太粗,無法回答「哪一天開始超額」。快照由背景 job 產生,完全不碰請求路徑。

   **為什麼現在就採集**(自動化計費還很遠)|**過去無法重建**。這是本模組唯一
   「晚做就永久失去」的東西 —— 手工開帳單期間若無用量佐證,收費爭議無從查證(FMEA B7)。

   跨租戶維運作業 → 特權車道(app 車道之 RLS 只看得到單一租戶)。
   交易範圍 advisory lock:多實例只有一個真的跑(承 F-6 CleanupService 模式)。 */

const USAGE_LOCK_KEY = 909_002

/* 指標碼。**新定義用新碼並存,不改寫歷史**(FMEA B5)——
   例:日後「計費使用者」改定義,新增 `billable_users_v2`,舊碼原樣保留。 */
export const USAGE_METRICS = {
  /* OQ-SB-3=A:有角色指派且未停用者 = 席位。買的是席位不是活躍度。 */
  billableUsers: "billable_users",
  /* OQ-SB-3 附帶:記錄但**不計費**,供日後若要改模型時有歷史可回溯。 */
  activeUsers: "active_users",
  forms: "forms",
  storageBytes: "storage_bytes",
} as const

/* **刻意未採集:記錄總數。** 需逐張動態表 count → 每租戶 O(表數) 次查詢,
   對每日全租戶掃描的 job 成本不成比例。docs/05 的定價亦不以記錄數計價
   (方案切的是模組包 + 席位)。若日後改為用量計價再補,屆時新增指標碼即可。 */

export interface UsageRunResult {
  readonly tenants: number
  readonly rows: number
  readonly skipped: boolean
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name)

  constructor(@Inject(DDL_KNEX) private readonly knex: Knex) {}

  /* 凌晨採計前一日 —— 當日尚未結束,快照會是半天的數字。 */
  /* 🔴 具名不只是為了可讀(F-9 §4.1)。`SchedulerOrchestrator` 對未命名的 cron 用
     `crypto.randomUUID()` 當 key —— **永遠不會撞名**,所以 `ScheduleModule` 若被重複註冊,
     同一個 job 會靜默註冊多份、每次到點跑多次。具名之後第二次註冊即撞名,
     `SchedulerRegistry.addCronJob` 直接拋 DUPLICATE_SCHEDULER → **開機失敗而非靜默重複**。 */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: "billing.usageRollup" })
  async scheduled(): Promise<void> {
    try {
      const result = await this.run(yesterday())
      if (!result.skipped) this.logger.log(`usage snapshot: ${JSON.stringify(result)}`)
    } catch (error) {
      // 非關鍵路徑:失敗只告警,不影響主流程
      this.logger.error(`usage snapshot failed: ${error instanceof Error ? error.message : error}`)
    }
  }

  /* 指定日期可重跑 —— 唯一鍵 (tenant_id, day, metric) 使其冪等,漏跑可補算(FMEA B4)。 */
  async run(day: string): Promise<UsageRunResult> {
    return this.knex.transaction(async (trx) => {
      const locked = await trx.raw<{ rows: { locked: boolean }[] }>(
        "SELECT pg_try_advisory_xact_lock(?) AS locked",
        [USAGE_LOCK_KEY],
      )
      if (locked.rows[0]?.locked !== true) return { tenants: 0, rows: 0, skipped: true }

      const tenantRows = await trx.table("tenants").select<{ id: number | string }[]>("id")
      let rows = 0
      for (const { id } of tenantRows) {
        rows += await this.snapshotTenant(trx, Number(id), day)
      }
      return { tenants: tenantRows.length, rows, skipped: false }
    })
  }

  private async snapshotTenant(trx: Knex, tenantId: number, day: string): Promise<number> {
    const metrics = {
      [USAGE_METRICS.billableUsers]: await this.billableUsers(trx, tenantId),
      [USAGE_METRICS.activeUsers]: await this.activeUsers(trx, tenantId, day),
      [USAGE_METRICS.forms]: await this.countWhere(trx, "form_def", tenantId),
      [USAGE_METRICS.storageBytes]: await this.storageBytes(trx, tenantId),
    }
    const values = Object.entries(metrics).map(([metric, value]) => ({
      tenant_id: tenantId,
      day,
      metric,
      value: String(value),
    }))
    await trx("tenant_usage_daily")
      .insert(values)
      /* 重跑覆寫同日同指標 —— 補算要能修正,但**不同日的歷史永不受影響** */
      .onConflict(["tenant_id", "day", "metric"])
      .merge(["value", "recorded_at"])
    return values.length
  }

  /* OQ-SB-3=A|有角色指派且未停用。
     OQ-SB-4=A|外部使用者不佔 seat —— 該功能尚未實作,屆時以「無 role_members 列」自然排除。
     DISTINCT:一人多角色只算一個席位。 */
  private async billableUsers(trx: Knex, tenantId: number): Promise<number> {
    const row = await trx
      .table("role_members")
      .join("users", "users.id", "role_members.actor_id")
      .where("role_members.tenant_id", tenantId)
      .whereNull("users.deleted_at")
      .countDistinct<{ count: string }[]>("role_members.actor_id as count")
    return Number(row[0]?.count ?? 0)
  }

  /* 當日有動作者(以記錄異動之 updated_by 為代理)。**不計費**,只留歷史。
     刻意不查 session 表:登入 ≠ 使用,且 session 保留期短於用量保留期。 */
  private async activeUsers(trx: Knex, tenantId: number, day: string): Promise<number> {
    const row = await trx
      .table("action_audit")
      .where("tenant_id", tenantId)
      .whereRaw("created_at >= ?::date AND created_at < ?::date + interval '1 day'", [day, day])
      .countDistinct<{ count: string }[]>("actor_id as count")
    return Number(row[0]?.count ?? 0)
  }

  private async countWhere(trx: Knex, table: string, tenantId: number): Promise<number> {
    const row = await trx
      .table(table)
      .where("tenant_id", tenantId)
      .whereNull("deleted_at")
      .count<{ count: string }[]>("* as count")
    return Number(row[0]?.count ?? 0)
  }

  private async storageBytes(trx: Knex, tenantId: number): Promise<number> {
    const row = await trx
      .table("file_object")
      .where("tenant_id", tenantId)
      .where("status", "bound")
      .sum<{ total: string | null }[]>("size as total")
    return Number(row[0]?.total ?? 0)
  }

  /* 管理端查詢:某租戶一段期間的用量。走特權車道(維運視角)。 */
  async history(
    tenantId: number,
    from: string,
    to: string,
  ): Promise<{ day: string; metric: string; value: string }[]> {
    return this.knex
      .table("tenant_usage_daily")
      .where("tenant_id", tenantId)
      .whereBetween("day", [from, to])
      .orderBy([{ column: "day" }, { column: "metric" }])
      .select("day", "metric", "value")
  }
}

function yesterday(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
