import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"

import { type FormatCondition, conditionsMatch } from "@weyver/rules"
import { compileValues } from "../actions/compile-values.js"
import { PermissionService } from "../authz/permission.service.js"
import { DDL_KNEX } from "../db/db.module.js"
import { RecordService } from "../form-engine/records/record.service.js"
import type { TriggerConfig } from "./trigger-specs.js"
import { TriggersRepository } from "./triggers.repository.js"

/* 🔴 R1·C-5|定時觸發。**補上 Ragic 要寫 JavaScript 的那個位置。**

   Ragic 的通用排程是 Daily Workflow,而那是 JS 工作流程引擎的一種階段
   (`doc-kb/260` 逐字:「如果你希望每日自動針對特定表單的所有資料同步…
   **可以考慮利用程式**」)。本模組用 C-4 已有的封閉 allowlist 做到同一件事,
   不寫程式。

   ## 語意:掃全表,對符合條件的每一筆執行

   照 Ragic 提醒的模型(`doc/96` 逐字:「系統就會在該時區每天的 19:00
   **檢查資料庫中所有的提醒功能**,如果有符合條件的,就會自動依序寄出提醒」)。
   即定時觸發不是「執行一次」,是「**對所有符合條件的記錄各執行一次**」。

   ## 時區

   判斷**全部在 PG 做**(OQ-SCH-2)。應用層自己算時區的話,會與 `record.service`
   既有的日期分組用兩套規則,而那是「兩份鏡射必然漂移」。

   ## 身分

   以**建立者**的身分執行(`trigger_def.created_by`)。C-4 拒絕系統身分,
   而排程沒有觸發者 —— 不記住是誰建的,就只能永遠記 `denied`。 */

const SCHEDULE_LOCK_KEY = 909_006

/* 🔴 一次掃描的記錄上限。

   ⚠️ **這個數字沒有外部依據**(同 C-4 的 `MAX_ATTEMPTS` / `BATCH_LIMIT`)。
   Ragic 的可比數字是「相關表單公式重算 2000 筆」,但那是**不同的東西**
   (它算的是公式,我方跑的是動作),不能直接搬。

   🔴 **但處理方式刻意與 Ragic 相反。** 官方逐字:「若需重算的資料超過系統限制,
   **所有相關表單資料都不會進行公式重算**」—— 超過上限就整批放棄。
   我方**處理前 N 筆並在執行紀錄註明還有多少沒處理**:
   做一半並說出來,比什麼都不做然後只在左下角跳一個訊息好。 */
const MAX_SCHEDULED_RECORDS = 1000

interface DueRow {
  id: number
  tenant_id: number
  form_id: number
  created_by: number | null
  conditions: unknown
  published: unknown
}

@Injectable()
export class TriggerScheduleService {
  private readonly logger = new Logger(TriggerScheduleService.name)

  constructor(
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(TriggersRepository) private readonly repo: TriggersRepository,
    @Inject(RecordService) private readonly records: RecordService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  /* 每小時整點。**最小粒度是小時**,對齊 Ragic 的「每天 19:00」語意。 */
  @Cron(CronExpression.EVERY_HOUR, { name: "trigger.schedule" })
  async scheduled(): Promise<void> {
    try {
      const result = await this.run()
      if (result.fired > 0) this.logger.log(`scheduled triggers: ${JSON.stringify(result)}`)
    } catch (error) {
      this.logger.error(
        `scheduled triggers failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async run(): Promise<{ fired: number; affected: number; skipped: boolean }> {
    const gate = await this.knex.raw<{ rows: { locked: boolean }[] }>(
      "SELECT pg_try_advisory_lock(?) AS locked",
      [SCHEDULE_LOCK_KEY],
    )
    if (gate.rows[0]?.locked !== true) return { fired: 0, affected: 0, skipped: true }
    try {
      const due = await this.claimDue()
      let affected = 0
      for (const row of due) affected += await this.fire(row)
      return { fired: due.length, affected, skipped: false }
    } finally {
      await this.knex.raw("SELECT pg_advisory_unlock(?)", [SCHEDULE_LOCK_KEY])
    }
  }

  /* 🔴 到期判斷**整段在 PG**。三件事都要租戶的當地時間:現在幾點、星期幾、幾號。

     **`>= schedule_hour` 是漏跑補一次(OQ-SCH-5)**:process 在 08:00 掛掉、
     11:00 回來,這一條仍然跑得到。而「只補最近一次」是 `last_run_at` 的日期比較
     自然給的 —— 停機三天回來只會跑一次,不會補 72 次。

     ⚠️ **已知限制**:weekly / monthly 的補跑**只在當天有效**。
     若整個週一都停機,那一週的週報就跳過了(隔天 dow 已經不符)。
     這是刻意的取捨 —— 「週一寄的週報在週二寄出」未必是使用者要的。
     但它目前是**靜默**的,已列 FMEA。 */
  private async claimDue(): Promise<DueRow[]> {
    const { rows } = await this.knex.raw<{ rows: DueRow[] }>(
      `WITH local AS (
         SELECT t.id AS tenant_id,
                (now() AT TIME ZONE t.timezone)                       AS ts,
                (now() AT TIME ZONE t.timezone)::date                 AS d,
                EXTRACT(hour FROM now() AT TIME ZONE t.timezone)::int AS h,
                EXTRACT(dow  FROM now() AT TIME ZONE t.timezone)::int AS dow,
                EXTRACT(day  FROM now() AT TIME ZONE t.timezone)::int AS dom,
                (date_trunc('month', now() AT TIME ZONE t.timezone)
                   + interval '1 month - 1 day')::date                AS month_end,
                t.timezone
           FROM tenants t
       )
       SELECT td.id, td.tenant_id, td.form_id, td.created_by, td.conditions, td.published
         FROM trigger_def td
         JOIN local l ON l.tenant_id = td.tenant_id
        WHERE td.on_schedule
          AND td.deleted_at IS NULL
          AND td.enabled
          AND td.published IS NOT NULL
          AND l.h >= td.schedule_hour
          AND (td.last_run_at IS NULL
               OR (td.last_run_at AT TIME ZONE l.timezone)::date < l.d)
          AND (
                td.schedule_freq = 'daily'
             OR (td.schedule_freq = 'weekly'  AND l.dow = td.schedule_day)
             OR (td.schedule_freq = 'monthly' AND (
                    (td.schedule_day > 0 AND l.dom = td.schedule_day)
                 OR (td.schedule_day = 0 AND l.d = l.month_end)))
          )
        ORDER BY td.tenant_id, td.position, td.id`,
    )
    /* bigint 從 raw SQL 回來是字串 —— C-4 已為此付過一次代價(靜默變成「沒有權限」)。 */
    return rows.map((r) => ({
      ...r,
      id: Number(r.id),
      tenant_id: Number(r.tenant_id),
      form_id: Number(r.form_id),
      created_by: r.created_by === null ? null : Number(r.created_by),
    }))
  }

  /* 標記跑過。**無論成敗都標** —— 失敗了還一直重試的話,
     一條設壞的定時觸發會每小時掃一次全表。失敗要靠執行紀錄被看見,不是靠重試。 */
  private async markRan(id: number): Promise<void> {
    await this.knex("trigger_def").where({ id }).update({ last_run_at: this.knex.fn.now() })
  }

  private async fire(row: DueRow): Promise<number> {
    const published = row.published as { config?: TriggerConfig } | null
    const config = published?.config
    const conditions = (row.conditions ?? []) as FormatCondition[]

    if (row.created_by === null) {
      await this.deny(row, "這條定時觸發沒有建立者,無法決定以誰的權限執行")
      return 0
    }
    /* 🔴 定時側只做 `updateSelf`。`pushTo` 掃一次全表可能建出上千筆記錄,
       而它跨到別張表 —— 那個授權問題與「掃全表」的量級問題疊在一起,
       需要獨立裁定。**在那之前寧可明確拒絕,不要半做**(已列殘留)。 */
    if (config?.actionType !== "updateSelf") {
      await this.deny(row, "定時觸發目前只支援「更新本筆欄位」")
      return 0
    }

    try {
      const perms = await this.permissions.resolveForActor(row.tenant_id, row.created_by)
      const page = await this.records.listRecords(
        row.tenant_id,
        row.form_id,
        { filters: [], sort: [], limit: MAX_SCHEDULED_RECORDS + 1 },
        perms,
        row.created_by,
      )
      const all = page.records
      const capped = all.length > MAX_SCHEDULED_RECORDS
      const batch = capped ? all.slice(0, MAX_SCHEDULED_RECORDS) : all

      let affected = 0
      for (const rec of batch) {
        const known = new Set(Object.keys(rec.values))
        if (conditions.length > 0 && !conditionsMatch(conditions, "and", rec.values, known)) {
          continue
        }
        const patch = compileValues(config.setFields, rec.values, row.created_by)
        /* 🔴 逐筆各自一個 `updateRecord`,不做批次 UPDATE。
           那樣才會經過同一條寫入咽喉:修改紀錄 / 搜尋索引 / 事件 / 遮罩檢查
           全部照走。批次 SQL 快得多,但會繞過那四樣,而繞過的東西
           要三個月後才會有人發現。 */
        await this.records.updateRecord(
          row.tenant_id,
          row.form_id,
          rec.id,
          rec.version,
          patch,
          row.created_by,
          undefined,
          { acknowledgeWarnings: true },
        )
        affected += 1
      }

      await this.repo.recordRun({
        tenantId: row.tenant_id,
        triggerId: row.id,
        formId: row.form_id,
        recordId: 0,
        actorId: row.created_by,
        outcome: "ran",
        detail: {
          scanned: batch.length,
          affected,
          /* 🔴 超過上限時**說出來**。Ragic 的做法是整批放棄(官方逐字
             「所有相關表單資料都不會進行公式重算」)—— 我方做一半並回報。 */
          ...(capped ? { capped: MAX_SCHEDULED_RECORDS, note: "超過單次上限,其餘留待下次" } : {}),
        },
      })
      return affected
    } catch (error) {
      await this.repo.recordRun({
        tenantId: row.tenant_id,
        triggerId: row.id,
        formId: row.form_id,
        recordId: 0,
        actorId: row.created_by,
        outcome: "failed",
        detail: { message: error instanceof Error ? error.message : String(error) },
      })
      return 0
    } finally {
      await this.markRan(row.id)
    }
  }

  private async deny(row: DueRow, reason: string): Promise<void> {
    await this.repo.recordRun({
      tenantId: row.tenant_id,
      triggerId: row.id,
      formId: row.form_id,
      recordId: 0,
      actorId: row.created_by,
      outcome: "denied",
      detail: { reason },
    })
    await this.markRan(row.id)
  }
}
