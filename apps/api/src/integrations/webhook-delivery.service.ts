import crypto from "node:crypto"
import type https from "node:https"
import { request as httpsRequest } from "node:https"
import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"
import { DDL_KNEX } from "../db/db.module.js"
import {
  SsrfBlockedError,
  assertSafeHeaders,
  pinnedAgent,
  resolveSafeTarget,
} from "./ssrf-guard.js"
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
const RESPONSE_SNIPPET_BYTES = 2048
const DELIVERY_LOCK_KEY = 909_003

/* Svix 的**雙條件**停用:單看連續失敗次數會讓消費端一次短暫維護就被停用。 */
const DISABLE_AFTER_FAILURES = 20
const DISABLE_AFTER_HOURS = 120

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
        const res = await postJson(target.url, agent, body, {
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

    await (outcome.ok ? this.markSent(row, outcome.code, outcome.snippet) : this.markFailed(row, outcome))
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
      if (state.consecutive_failures >= DISABLE_AFTER_FAILURES && hoursFailing >= DISABLE_AFTER_HOURS) {
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
async function postJson(
  url: URL,
  agent: https.Agent,
  body: string,
  headers: Readonly<Record<string, string>>,
): Promise<{ status: number; body: string | null }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port === "" ? 443 : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        agent,
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let chunks = ""
        res.setEncoding("utf8")
        res.on("data", (c: string) => {
          // 只留前段:回應可能很大,而我們只是要讓使用者看得出哪裡不對
          if (chunks.length < RESPONSE_SNIPPET_BYTES) chunks += c
        })
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: chunks.slice(0, RESPONSE_SNIPPET_BYTES) })
        })
      },
    )
    req.on("timeout", () => {
      req.destroy(new Error(`逾時(${String(REQUEST_TIMEOUT_MS)}ms)`))
    })
    req.on("error", reject)
    req.end(body)
  })
}

/* 對外的 webhook-id。重送時**沿用**同一個 —— 消費端靠它去重(GitHub 同做法)。 */
export function newMessageId(): string {
  return `msg_${crypto.randomBytes(16).toString("base64url")}`
}
