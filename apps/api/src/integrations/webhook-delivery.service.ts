import crypto from "node:crypto"
import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"
import { DDL_KNEX } from "../db/db.module.js"
import {
  SsrfBlockedError,
  assertSafeHeaders,
  pinnedAgent,
  resolveSafeTarget,
} from "../http/ssrf-guard.js"
import { postJsonToTarget } from "../http/safe-post.js"
import { signPayload } from "./webhook-signature.js"

/* G-1 M3|Webhook 投遞。

   **不引進 BullMQ**(OQ-WH-1=A):它根本沒安裝,而 `notification_delivery` 的
   「cron 抽取 + 退避欄位」模式已在 prod 驗證過。且研究指出 BullMQ 的 group 併發是
   **Pro 商業功能**,OSS-only 下引進也換不到我們想要的順序保證。

   **at-least-once,不假裝 exactly-once**:無任何廠商宣稱做得到。
   重送沿用同一個 `webhook-id`,消費端才去重得掉。 */

/* Svix 曲線(分鐘)。ERP 過帳類事件靠總時長 ~3 天吸收消費端的長時間維護。 */
const BACKOFF_MINUTES = [0, 5 / 60, 5, 30, 120, 300, 600, 600, 1440, 1440] as const
const MAX_ATTEMPTS = BACKOFF_MINUTES.length
const BATCH_LIMIT = 50
const REQUEST_TIMEOUT_MS = 10_000
const DELIVERY_LOCK_KEY = 909_003

/* Svix 的**雙條件**停用:單看連續失敗次數會讓消費端一次短暫維護就被停用。 */
const DISABLE_AFTER_FAILURES = 20
const DISABLE_AFTER_HOURS = 120

/* 🔴 W7|投遞紀錄保留期。每一列都帶一份完整的載荷(業務資料快照)與回應內容,
   而在此之前**沒有任何機制會清掉它們** —— 既是無上限成長,也是「業務資料的副本
   無限期躺在另一張表裡」的保留期破口。

   分兩段而不是一刀刪:排查「這筆到底送出去了沒、對方回什麼碼」通常發生在幾天內,
   而「我們有沒有把這筆資料送給外部端點」是內控要問的問題,答案不該跟著內容一起消失。
   故 30 天後清內容留 metadata,一年後才整列刪除 —— 與回收桶「刪檔案、留列給稽核」同一個取捨。 */
const PAYLOAD_RETENTION_DAYS = 30
const ROW_RETENTION_DAYS = 365
const PRUNE_BATCH = 1000
const RETENTION_LOCK_KEY = 909_004

interface DueRow {
  id: number
  tenant_id: number
  endpoint_id: number
  message_id: string
  event_type: string
  payload: unknown
  attempts: number
  url: string
  secret: string
  secret_prev: string | null
}

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name)

  constructor(@Inject(DDL_KNEX) private readonly knex: Knex) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: "webhook.deliver" })
  async scheduled(): Promise<void> {
    try {
      await this.run()
    } catch (error) {
      // 投遞為非關鍵路徑:失敗只告警,不影響主流程
      this.logger.error(
        `webhook deliver failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /* 具名為硬性要求(F-9 §4.1):未具名的 cron 以 UUID 進 registry,
     `ScheduleModule` 重複註冊時偵測不到,同一個 job 會靜默跑多次。 */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: "webhook.retention" })
  async scheduledRetention(): Promise<void> {
    try {
      const result = await this.enforceRetention()
      if (!result.skipped && (result.pruned > 0 || result.deleted > 0)) {
        this.logger.log(`webhook retention: ${JSON.stringify(result)}`)
      }
    } catch (error) {
      this.logger.error(
        `webhook retention failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /* 跨租戶維運 → 特權車道 + advisory lock 擋多實例。
   **只清已了結的投遞**(sent / failed):還在 pending 的載荷是待送內容,清掉就送不出去了。 */
  async enforceRetention(): Promise<{ pruned: number; deleted: number; skipped: boolean }> {
    const gate = await this.knex.raw<{ rows: { locked: boolean }[] }>(
      "SELECT pg_try_advisory_lock(?) AS locked",
      [RETENTION_LOCK_KEY],
    )
    if (gate.rows[0]?.locked !== true) return { pruned: 0, deleted: 0, skipped: true }
    try {
      const pruned = await this.knex("webhook_delivery")
        .whereIn(
          "id",
          this.knex("webhook_delivery")
            .select("id")
            .whereNull("pruned_at")
            .whereIn("status", ["sent", "failed"])
            .whereRaw(`created_at < now() - interval '${String(PAYLOAD_RETENTION_DAYS)} days'`)
            .limit(PRUNE_BATCH),
        )
        .update({
          /* 載荷欄位為 NOT NULL,故以空物件取代而非設 NULL；
             「有沒有被清過」由 `pruned_at` 回答,不靠猜空物件的語意。 */
          payload: this.knex.raw("'{}'::jsonb"),
          response_body: null,
          pruned_at: this.knex.fn.now(),
        })

      const deleted = await this.knex("webhook_delivery")
        .whereIn(
          "id",
          this.knex("webhook_delivery")
            .select("id")
            .whereIn("status", ["sent", "failed"])
            .whereRaw(`created_at < now() - interval '${String(ROW_RETENTION_DAYS)} days'`)
            .limit(PRUNE_BATCH),
        )
        .delete()

      return { pruned, deleted, skipped: false }
    } finally {
      await this.knex.raw("SELECT pg_advisory_unlock(?)", [RETENTION_LOCK_KEY])
    }
  }

  async run(): Promise<{ attempted: number; skipped: boolean }> {
    const gate = await this.knex.raw<{ rows: { locked: boolean }[] }>(
      "SELECT pg_try_advisory_lock(?) AS locked",
      [DELIVERY_LOCK_KEY],
    )
    if (gate.rows[0]?.locked !== true) return { attempted: 0, skipped: true }
    try {
      const due = await this.claimDue()
      for (const row of due) await this.attempt(row)
      return { attempted: due.length, skipped: false }
    } finally {
      await this.knex.raw("SELECT pg_advisory_unlock(?)", [DELIVERY_LOCK_KEY])
    }
  }

  /* 跨租戶維運 → 特權車道。只取「端點還活著且已通過驗證挑戰」的。 */
  private async claimDue(): Promise<DueRow[]> {
    const { rows } = await this.knex.raw<{ rows: DueRow[] }>(
      `SELECT d.id, d.tenant_id, d.endpoint_id, d.message_id, d.event_type, d.payload,
              d.attempts, e.url, e.secret, e.secret_prev
         FROM webhook_delivery d
         JOIN webhook_endpoint e ON e.id = d.endpoint_id
        WHERE d.status = 'pending'
          AND d.next_attempt_at <= now()
          AND e.deleted_at IS NULL
          AND e.disabled_at IS NULL
          AND e.verified_at IS NOT NULL
        ORDER BY d.next_attempt_at
        LIMIT ?`,
      [BATCH_LIMIT],
    )
    return rows
  }

  private async attempt(row: DueRow): Promise<void> {
    const body = JSON.stringify(row.payload)
    const timestamp = Math.floor(Date.now() / 1000)
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "Weyver-Webhooks/1.0",
    }
    assertSafeHeaders({ "user-agent": headers["user-agent"] ?? "" })

    let outcome: { ok: boolean; code: number | null; snippet: string | null; error: string | null }
    try {
      /* 🔴 每次投遞都**重新解析並驗證** —— 端點 URL 的 DNS 可能在建立之後才被改成內網。
         驗證通過的 IP 直接 pin 進 dispatcher,undici 不再自行解析(ssrf-guard 詳述)。 */
      const target = await resolveSafeTarget(row.url)
      const agent = pinnedAgent(target, REQUEST_TIMEOUT_MS)
      try {
        const res = await postJsonToTarget(target.url, agent, body, {
          ...headers,
          "webhook-id": row.message_id,
          "webhook-timestamp": String(timestamp),
          "webhook-signature": signPayload({
            messageId: row.message_id,
            timestamp,
            body,
            secret: row.secret,
            secretPrev: row.secret_prev,
          }),
        })
        /* 🔴 3xx 一律視為失敗(Stripe 同做法)。`https.request` 預設不跟隨,
           所以「先回公網 302 再跳內網」這類繞過在此直接斷掉。 */
        outcome = {
          ok: res.status >= 200 && res.status < 300,
          code: res.status,
          snippet: res.body,
          error:
            res.status >= 300 && res.status < 400
              ? `端點回應 ${String(res.status)} 轉址;基於安全考量不跟隨轉址,請直接填最終網址`
              : res.status >= 200 && res.status < 300
                ? null
                : `HTTP ${String(res.status)}`,
        }
      } finally {
        agent.destroy()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcome = {
        ok: false,
        code: null,
        snippet: null,
        error: error instanceof SsrfBlockedError ? `目標被安全規則擋下:${message}` : message,
      }
    }

    await (outcome.ok
      ? this.markSent(row, outcome.code, outcome.snippet)
      : this.markFailed(row, outcome))
  }

  private async markSent(row: DueRow, code: number | null, snippet: string | null): Promise<void> {
    await this.knex.transaction(async (trx) => {
      await trx("webhook_delivery")
        .where({ id: row.id })
        .update({
          status: "sent",
          attempts: row.attempts + 1,
          response_code: code,
          response_body: snippet,
          sent_at: trx.fn.now(),
        })
      // 成功即清空失敗計數 —— 否則偶發失敗會累積到誤停用
      await trx("webhook_endpoint")
        .where({ id: row.endpoint_id })
        .update({ consecutive_failures: 0, first_failure_at: null })
    })
  }

  private async markFailed(
    row: DueRow,
    outcome: { code: number | null; snippet: string | null; error: string | null },
  ): Promise<void> {
    const attempts = row.attempts + 1
    const exhausted = attempts >= MAX_ATTEMPTS
    const backoff = BACKOFF_MINUTES[attempts] ?? BACKOFF_MINUTES[MAX_ATTEMPTS - 1] ?? 1440

    await this.knex.transaction(async (trx) => {
      await trx("webhook_delivery")
        .where({ id: row.id })
        .update({
          status: exhausted ? "failed" : "pending",
          attempts,
          response_code: outcome.code,
          response_body: outcome.snippet,
          last_error: outcome.error,
          next_attempt_at: trx.raw(`now() + interval '${String(backoff)} minutes'`),
        })

      const updated = await trx("webhook_endpoint")
        .where({ id: row.endpoint_id })
        .update({
          consecutive_failures: trx.raw("consecutive_failures + 1"),
          first_failure_at: trx.raw("COALESCE(first_failure_at, now())"),
        })
        .returning<{ consecutive_failures: number; first_failure_at: Date | null }[]>([
          "consecutive_failures",
          "first_failure_at",
        ])

      /* 🔴 雙條件才停用(Svix)。只看次數的話,消費端一次十分鐘維護就被停;
         只看時間的話,一個低頻端點壞很久卻沒累積幾次失敗也不會被停。 */
      const state = updated[0]
      if (state === undefined || state.first_failure_at === null) return
      const hoursFailing = (Date.now() - new Date(state.first_failure_at).getTime()) / 3_600_000
      if (
        state.consecutive_failures >= DISABLE_AFTER_FAILURES &&
        hoursFailing >= DISABLE_AFTER_HOURS
      ) {
        await trx("webhook_endpoint")
          .where({ id: row.endpoint_id })
          .update({
            disabled_at: trx.fn.now(),
            disabled_reason: `連續失敗 ${String(state.consecutive_failures)} 次、持續 ${String(Math.round(hoursFailing))} 小時`,
          })
        this.logger.warn(`webhook endpoint ${String(row.endpoint_id)} 自動停用`)
      }
    })
  }
}

/* `https.request` 的 promise 包裝。刻意不用全域 fetch:fetch 走 Node 內建 undici,
   而 undici 的 dispatcher 型別與內建 undici-types 版本不一致,且 fetch 需要額外
   `redirect:"error"` 才不跟隨轉址 —— `https.request` 預設就不跟隨,少一個要記得設的開關。 */

/* 對外的 webhook-id。重送時**沿用**同一個 —— 消費端靠它去重(GitHub 同做法)。 */
export function newMessageId(): string {
  return `msg_${crypto.randomBytes(16).toString("base64url")}`
}
