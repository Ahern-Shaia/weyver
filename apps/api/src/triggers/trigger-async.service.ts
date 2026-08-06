import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"

import { conditionsMatch } from "@weyver/rules"
import { compileValues } from "../actions/compile-values.js"
import { PermissionService } from "../authz/permission.service.js"
import { DDL_KNEX } from "../db/db.module.js"
import { RecordService } from "../form-engine/records/record.service.js"
import { type TriggerRow, TriggersRepository } from "./triggers.repository.js"

/* 🔴 R1·C-4 M3|事件觸發器的非同步側(`pushTo`:往別張表建記錄)。

   ## 為什麼這一半不能跟同步側一樣

   同步側改的是「即將寫入的值」,所以它不會失敗到需要重試 —— 算不出來就擋存檔。
   `pushTo` 不一樣:它往**別張表**寫,而那張表可能沒權限、可能驗證不過、
   可能根本被刪了。讓那種失敗拖垮使用者的存檔,等於「別人的表設錯了,我這張表存不了」。

   所以它走既有的 `event_outbox`,失敗只影響它自己。

   ## 為什麼是另一個標記欄而不是共用 `fanned_out_at`

   扇出(通知 / webhook)是 at-least-once 的。共用標記的話,觸發器失敗重試
   會把整列重跑,使用者於是**收到重複通知**,而原因是一條跟他無關的觸發器失敗了。

   ## 🔴 連鎖:唯一真正危險的地方

   A 表的觸發器往 B 表建記錄 → B 的 `record.created` → B 表的觸發器往 A 表建記錄 → 無限。
   **同步側沒有這個問題**(不發新事件),這一側有。

   `event_outbox.depth` 記祖先鏈長度:worker 建完記錄後,把子事件的 depth
   補成父深度 + 1。超過上限就停,**並寫一筆 `depth` 執行紀錄** ——
   靜默停止的自動化比不會動的自動化更難查,使用者只會說「它沒反應」。

   ## 身分:以觸發者執行,不另開系統身分

   與同步側的 `updateSelf` **不同**。`updateSelf` 動的是這張表這一筆,
   而觸發器是這張表的設計者設的;`pushTo` 跨到別張表,設計者未必有那張表的權限。
   一旦給了系統身分,「我看不到那張表,但我可以設一條觸發器往裡面寫」就成立。
   權限不足 → 寫 `denied`,不升權。 */

/* 🔴 這四個數字的出處(2026-08-06 補查;第一版全是憑感覺訂的)。

   ## `MAX_DEPTH = 5` —— 有外部錨,但刻意訂得更嚴

   **Salesforce Apex Governor Limits 逐字**:「Total stack depth for any Apex invocation
   that **recursively fires triggers** due to insert, update, or delete statements: **16**」
   <https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_apexgov.htm>

   我方取 5 而非 16:Salesforce 的 16 涵蓋的是**同交易內的 Apex 呼叫堆疊**,
   而我方這一側是**跨分鐘的非同步鏈**,每一層都是一筆真實記錄。
   五代之後還在連鎖,幾乎必然是設定錯誤而不是業務需求。
   **這是我方的裁定,不是照抄** —— 16 只用來確認「業界確實會設上限」。

   ## 對照組:兩家競品**都沒有**系統層的遞迴防護(逐字)

   - **Airtable**:「this automation will **loop endlessly until you've exhausted
     your workspace plan limits**」(`troubleshooting-airtable-automations`)
     —— 唯一的煞車是燒完月配額。
   - **Teable**:「be careful to avoid infinite loops. **Use a filter to exclude records
     that were created by automation** (for example, by checking a flag field)」
     (`automation/trigger/records/record-created`)—— 責任推給使用者自己加旗標欄。

   兩條都是本專案開檔覆查過的逐字原文。

   ## 🔴 `MAX_ATTEMPTS = 3` 與 `BATCH_LIMIT = 100` —— **無外部依據,誠實記**

   查過的兩家都幫不上:Airtable **不自動重試**(只給手動 Rerun,並要使用者
   「build redundancy... using retry logic or delay steps」);Teable 給的是
   full rerun / resume-from-failed 兩個**手動**選項。批次大小同樣無對應數字。

   所以這兩個值是**我方憑工程判斷訂的**,沒有出處。留在這裡是為了讓下一個人知道
   「動它不需要先推翻誰」——(`docs/22`:數值無出處就不寫成規範)。 */
const BATCH_LIMIT = 100
const TRIGGER_LOCK_KEY = 909_005
const MAX_DEPTH = 5
const MAX_ATTEMPTS = 3

/* 🔴 FMEA T7|**一次使用者存檔最多可以連帶產生幾筆資料。**

   `MAX_DEPTH` 限的是鏈長,不是分支 —— 兩者**相乘**:
   一張表掛 T 條 pushTo,深度 5 的最壞情況是 T⁵(T=20 → 320 萬筆)。
   只限深度完全擋不住。

   刻意限「後代總數」而不是「每個事件最多跑幾條觸發器」:
   一張表掛 10 條各做各的事的觸發器完全正常,限分支會誤傷合法設定。
   真正該問的是「一次存檔最多連帶產生幾筆」—— 那是使用者理解得了、
   資料庫也真的承受的那個量。

   ⚠️ **100 無外部依據**(同 `MAX_ATTEMPTS`)。查過的兩家都幫不上:
   Airtable 的煞車是**月配額**(Free 100 / Team 25,000 / Business 100,000 runs
   per workspace per month),那是計費單位不是連鎖單位;Teable 沒有。
   選 100 的理由是:`pushTo` 一條觸發器只建**一筆**(不隨資料量放大),
   所以合法的連鎖本來就小;一次存檔連帶產生超過 100 筆,幾乎必然是設定錯誤。 */
const MAX_CASCADE = 100

interface OutboxRow {
  id: number
  tenant_id: number
  type: string
  form_id: number | null
  record_id: number | null
  actor_id: number | null
  depth: number
  trigger_attempts: number
  root_event_id: number | null
}

@Injectable()
export class TriggerAsyncService {
  private readonly logger = new Logger(TriggerAsyncService.name)

  constructor(
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(TriggersRepository) private readonly repo: TriggersRepository,
    @Inject(RecordService) private readonly records: RecordService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: "trigger.run" })
  async scheduled(): Promise<void> {
    try {
      const result = await this.run()
      if (result.processed > 0) this.logger.log(`trigger run: ${JSON.stringify(result)}`)
    } catch (error) {
      this.logger.error(
        `trigger run failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async run(): Promise<{ processed: number; executed: number; skipped: boolean }> {
    const gate = await this.knex.raw<{ rows: { locked: boolean }[] }>(
      "SELECT pg_try_advisory_lock(?) AS locked",
      [TRIGGER_LOCK_KEY],
    )
    if (gate.rows[0]?.locked !== true) return { processed: 0, executed: 0, skipped: true }
    try {
      const events = await this.claim()
      let executed = 0
      for (const event of events) executed += await this.handle(event)
      return { processed: events.length, executed, skipped: false }
    } finally {
      await this.knex.raw("SELECT pg_advisory_unlock(?)", [TRIGGER_LOCK_KEY])
    }
  }

  private async claim(): Promise<OutboxRow[]> {
    const { rows } = await this.knex.raw<{ rows: OutboxRow[] }>(
      `SELECT id, tenant_id, type, form_id, record_id, actor_id, depth, trigger_attempts,
              root_event_id
         FROM event_outbox
        WHERE trigger_run_at IS NULL AND form_id IS NOT NULL AND record_id IS NOT NULL
        ORDER BY occurred_at
        LIMIT ?`,
      [BATCH_LIMIT],
    )
    /* 🔴 **`bigint` 欄位從 raw SQL 回來是字串。**

       `node-postgres` 預設不把 int8 轉成 number(超過 2^53 會失真)。
       而下游的 `EffectivePermissions` 用 `Map<number, …>` 查表 ——
       傳字串進去 `Map.get("1")` 查不到數字鍵 `1`,於是**靜默變成「沒有任何權限」**:
       所有欄位隱藏、所有動作拒絕。不會拋錯,只會什麼都不做。

       這一整段除錯花掉的時間,全在於它往「拒絕」的方向無聲失敗 ——
       看起來就像「觸發器沒接上」。鄰居 `event-fanout` 沒踩到只是因為
       它把這些值幾乎只用在 SQL 裡(SQL 會自己轉型)。 */
    return rows.map((r) => ({
      ...r,
      id: Number(r.id),
      tenant_id: Number(r.tenant_id),
      form_id: r.form_id === null ? null : Number(r.form_id),
      record_id: r.record_id === null ? null : Number(r.record_id),
      actor_id: r.actor_id === null ? null : Number(r.actor_id),
      depth: Number(r.depth),
      trigger_attempts: Number(r.trigger_attempts),
      root_event_id: r.root_event_id === null ? null : Number(r.root_event_id),
    }))
  }

  private async done(id: number): Promise<void> {
    await this.knex("event_outbox").where({ id }).update({ trigger_run_at: this.knex.fn.now() })
  }

  private async handle(event: OutboxRow): Promise<number> {
    const formId = event.form_id
    const recordId = event.record_id
    if (formId === null || recordId === null) {
      await this.done(event.id)
      return 0
    }
    if (event.type !== "record.created" && event.type !== "record.updated") {
      await this.done(event.id)
      return 0
    }

    const isCreate = event.type === "record.created"
    const triggers = (await this.repo.listByForm(event.tenant_id, formId)).filter(
      (t) => t.enabled && t.config.actionType === "pushTo" && (isCreate ? t.onCreate : t.onUpdate),
    )
    if (triggers.length === 0) {
      await this.done(event.id)
      return 0
    }

    /* 🔴 連鎖的兩道閘,**兩道都要**:深度限鏈長、總量限分支,單獨任一道都擋不住乘法。

       檢查在**跑之前**,而且對每一條觸發器都寫紀錄 ——
       只記一次的話,設計者看到「有一條停了」卻不知道另外兩條也停了。 */
    const stop = await this.cascadeStop(event)
    if (stop !== null) {
      for (const t of triggers) {
        await this.repo.recordRun({
          tenantId: event.tenant_id,
          triggerId: t.id,
          formId,
          recordId,
          actorId: event.actor_id,
          outcome: "depth",
          detail: stop,
        })
      }
      await this.done(event.id)
      return 0
    }

    let executed = 0
    try {
      executed = await this.runTriggers(event, formId, recordId, triggers)
    } catch (error) {
      /* 整批的失敗(讀不到記錄 / 解不出權限)才走到這裡。
         個別觸發器的失敗在 `runTriggers` 內就吞掉並記了 —— 一條壞的不該擋住其他條。 */
      const attempts = event.trigger_attempts + 1
      if (attempts < MAX_ATTEMPTS) {
        await this.knex("event_outbox").where({ id: event.id }).update({
          trigger_attempts: attempts,
        })
        return 0
      }
      const message = error instanceof Error ? error.message : String(error)
      for (const t of triggers) {
        await this.repo.recordRun({
          tenantId: event.tenant_id,
          triggerId: t.id,
          formId,
          recordId,
          actorId: event.actor_id,
          outcome: "failed",
          detail: { attempts, message },
        })
      }
      await this.done(event.id)
      return 0
    }

    await this.done(event.id)
    return executed
  }

  /* 回 null = 可以跑;非 null = 該停,內容就是寫進執行紀錄的理由。 */
  private async cascadeStop(event: OutboxRow): Promise<Record<string, unknown> | null> {
    if (event.depth >= MAX_DEPTH) {
      return { reason: "depth", depth: event.depth, max: MAX_DEPTH }
    }
    /* 源頭事件(使用者直接造成的)不必數 —— 它的後代還沒產生。 */
    const root = event.root_event_id
    if (root === null) return null
    const { rows } = await this.knex.raw<{ rows: { n: string }[] }>(
      "SELECT count(*) AS n FROM event_outbox WHERE root_event_id = ?",
      [root],
    )
    const n = Number(rows[0]?.n ?? 0)
    return n >= MAX_CASCADE ? { reason: "cascade", produced: n, max: MAX_CASCADE } : null
  }

  private async runTriggers(
    event: OutboxRow,
    formId: number,
    recordId: number,
    triggers: readonly TriggerRow[],
  ): Promise<number> {
    const actorId = event.actor_id
    if (actorId === null) {
      /* 沒有觸發者就沒有身分可以套。**不退回系統身分** —— 那正是要避免的側門。 */
      for (const t of triggers) {
        await this.repo.recordRun({
          tenantId: event.tenant_id,
          triggerId: t.id,
          formId,
          recordId,
          actorId: null,
          outcome: "denied",
          detail: { reason: "事件沒有觸發者,無法決定以誰的權限執行" },
        })
      }
      return 0
    }

    const perms = await this.permissions.resolveForActor(event.tenant_id, actorId)
    const source = await this.records.getRecord(event.tenant_id, formId, recordId, perms, actorId)
    const known = new Set(Object.keys(source.values))

    let executed = 0
    for (const t of triggers) {
      if (t.conditions.length > 0 && !conditionsMatch(t.conditions, "and", source.values, known)) {
        continue
      }
      if (t.config.actionType !== "pushTo") continue
      const target = t.config.targetFormId
      if (perms.hasAction(target, "create") !== true) {
        await this.repo.recordRun({
          tenantId: event.tenant_id,
          triggerId: t.id,
          formId,
          recordId,
          actorId,
          outcome: "denied",
          detail: { targetFormId: target, reason: "觸發者無權於目標表單建立記錄" },
        })
        continue
      }
      try {
        const values = compileValues(t.config.fieldMap, source.values, actorId)
        const created = await this.records.createRecord(
          event.tenant_id,
          target,
          values,
          actorId,
          perms,
        )
        await this.stampChildDepth(event, target, created.id)
        await this.repo.recordRun({
          tenantId: event.tenant_id,
          triggerId: t.id,
          formId,
          recordId,
          actorId,
          outcome: "ran",
          detail: { targetFormId: target, targetRecordId: created.id },
        })
        executed += 1
      } catch (error) {
        /* 🔴 個別觸發器失敗**不重試也不擋別條**。
           重試整個事件會把已經成功的那幾條再跑一次 —— `pushTo` 不是冪等的,
           重跑等於再建一張單。使用者寧可看到「這條失敗了」也不要收到三張重複的單。 */
        await this.repo.recordRun({
          tenantId: event.tenant_id,
          triggerId: t.id,
          formId,
          recordId,
          actorId,
          outcome: "failed",
          detail: {
            targetFormId: target,
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
    }
    return executed
  }

  /* 剛建出來的記錄,它的事件此刻 depth = 0。補成父深度 + 1。

     🔴 安全性來自時序而非鎖:記錄是**這一瞬間**建出來的,所以它在 outbox 裡
     的列只可能來自這次建立;而本 worker 全程持有 advisory lock,
     下一輪才會撈到它。 */
  private async stampChildDepth(
    event: OutboxRow,
    targetFormId: number,
    targetRecordId: number,
  ): Promise<void> {
    await this.knex("event_outbox")
      .where({
        tenant_id: event.tenant_id,
        form_id: targetFormId,
        record_id: targetRecordId,
      })
      .whereNull("trigger_run_at")
      .update({
        depth: event.depth + 1,
        /* 🔴 源頭往下傳。`root_event_id` 為 null 代表**這個事件自己就是源頭**
           (使用者直接造成),所以子代掛在它的 id 上。 */
        root_event_id: event.root_event_id ?? event.id,
      })
  }
}
