import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"
import { DDL_KNEX } from "../db/db.module.js"
import { CHANNEL_IDS, isChannelId } from "./channel-registry.js"
import { ChannelSenderService } from "./channel-sender.service.js"
import { EmailChannel } from "./email.channel.js"
import { isApprovalEvent } from "./notification-specs.js"

/* H-1 M3|寄送派工。

   **輪詢而非 LISTEN/NOTIFY** —— PgBouncer transaction mode 下 LISTEN/NOTIFY 不可用,
   而 AGENTS P0 鐵則正是要求 tx mode(FMEA N17)。
   `FOR UPDATE SKIP LOCKED` 為 PostgreSQL 官方認可的佇列取件法(pg-boss / graphile-worker 同源)。

   **跨租戶掃描走特權車道** —— app 角色禁 BYPASSRLS,RLS FORCE 會擋住 worker
   (FMEA N17);沿用 F-8 UsageService 既有解。

   **同記錄去抖動**(OQ-NT-8 v0.4):一筆記錄連續編輯 10 次不該是 10 封信。
   承 Jira Cloud:per(收件人 + 記錄)3 分鐘 idle / 10 分鐘上限,
   **簽核等關鍵事件 bypass 立即送**。跨記錄 digest 才是 P0 不做的那個。 */

/* 非關鍵事件的去抖動視窗(承 Jira 3 分鐘) */
const COALESCE_IDLE_MINUTES = 3
const BATCH = 100
const MAX_ATTEMPTS = 5
const DISPATCH_LOCK_KEY = 909_003
/* 廣播另用一把鎖:它與 email 是兩條獨立的投遞路徑,共用一把鎖會讓
   其中一條卡住時另一條也停擺。 */
const BROADCAST_LOCK_KEY = 909_004
const BROADCAST_CHANNELS = CHANNEL_IDS.filter((c) => c !== "smtp")

interface BroadcastRow {
  readonly id: number
  readonly tenant_id: number
  readonly channel: string
  readonly attempts: number
  readonly event: string
  readonly title: string
}

interface DueRow {
  id: number
  notification_id: number
  tenant_id: number
  attempts: number
  event: string
  title: string
  form_id: number | null
  record_id: number | null
  recipient_actor_id: number
  email: string | null
}

@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name)

  constructor(
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(EmailChannel) private readonly email: EmailChannel,
    @Inject(ChannelSenderService) private readonly sender: ChannelSenderService,
  ) {}

  /* 🔴 具名不只是為了可讀(F-9 §4.1)。`SchedulerOrchestrator` 對未命名的 cron 用
     `crypto.randomUUID()` 當 key —— **永遠不會撞名**,所以 `ScheduleModule` 若被重複註冊,
     同一個 job 會靜默註冊多份、每次到點跑多次。具名之後第二次註冊即撞名,
     `SchedulerRegistry.addCronJob` 直接拋 DUPLICATE_SCHEDULER → **開機失敗而非靜默重複**。 */
  @Cron(CronExpression.EVERY_MINUTE, { name: "notifications.dispatch" })
  async scheduled(): Promise<void> {
    try {
      const n = await this.run()
      if (n > 0) this.logger.log(`dispatched ${n} email deliveries`)
      /* 廣播獨立於 email:上面掛了不該連帶讓廣播停擺,反之亦然 */
      const b = await this.runBroadcasts()
      if (b > 0) this.logger.log(`dispatched ${b} channel broadcasts`)
    } catch (error) {
      // 非關鍵路徑:失敗只告警
      this.logger.error(`dispatch failed: ${error instanceof Error ? error.message : error}`)
    }
  }

  async run(): Promise<number> {
    return this.knex.transaction(async (trx) => {
      const locked = await trx.raw<{ rows: { locked: boolean }[] }>(
        "SELECT pg_try_advisory_xact_lock(?) AS locked",
        [DISPATCH_LOCK_KEY],
      )
      if (locked.rows[0]?.locked !== true) return 0

      const due = await trx.raw<{ rows: DueRow[] }>(
        `SELECT d.id, d.notification_id, d.tenant_id, d.attempts,
                n.event, n.title, n.form_id, n.record_id, n.recipient_actor_id,
                u.email
           FROM notification_delivery d
           JOIN notification n ON n.id = d.notification_id
           LEFT JOIN users u ON u.id = n.recipient_actor_id
          WHERE d.channel = 'email'
            AND d.status = 'pending'
            AND d.next_attempt_at <= now()
          ORDER BY d.id
          LIMIT ?
            FOR UPDATE OF d SKIP LOCKED`,
        [BATCH],
      )
      if (due.rows.length === 0) return 0

      /* 去抖動 + 合併:同一(收件人 × 記錄)的待送件合成一封。
         Jira 的 idle window 語意 —— 只要該群組還在 3 分鐘內有新事件就再等,
         關鍵事件不等。 */
      const groups = new Map<string, DueRow[]>()
      for (const row of due.rows) {
        const key = `${row.recipient_actor_id}:${row.form_id}:${row.record_id}`
        groups.set(key, [...(groups.get(key) ?? []), row])
      }

      let sent = 0
      for (const rows of groups.values()) {
        sent += await this.sendGroup(trx, rows)
      }
      return sent
    })
  }

  /* 🔴 租戶級事件廣播的投遞(M5)。**與 email 分開一個迴圈**,因為三件事都不同:
     沒有收件人(不必查 users / 抑制清單)· 不做去抖動合併(群組看的是事件流,
     把「3 分鐘內的 5 則」合成一則反而失去時序)· 失敗語意不同(對方服務掛了,
     不是這個位址不能收)。硬塞進同一個迴圈只會讓兩邊都變難讀。 */
  async runBroadcasts(): Promise<number> {
    return this.knex.transaction(async (trx) => {
      const locked = await trx.raw<{ rows: { locked: boolean }[] }>(
        "SELECT pg_try_advisory_xact_lock(?) AS locked",
        [BROADCAST_LOCK_KEY],
      )
      if (locked.rows[0]?.locked !== true) return 0

      const due = await trx.raw<{ rows: BroadcastRow[] }>(
        `SELECT d.id, d.tenant_id, d.channel, d.attempts, n.event, n.title
           FROM notification_delivery d
           JOIN notification n ON n.id = d.notification_id
          WHERE d.channel = ANY(?)
            AND d.status = 'pending'
            AND d.next_attempt_at <= now()
          ORDER BY d.id
          LIMIT ?
            FOR UPDATE OF d SKIP LOCKED`,
        [BROADCAST_CHANNELS, BATCH],
      )

      let sent = 0
      for (const row of due.rows) {
        /* ⚠️ 內容只有標題與事件 —— `title` 由 `safeTitle` 產生,**不含欄位值**。
           對群組這條是不可協商的:成員可能對該表單毫無存取權。 */
        const text = `${row.title} ${eventText(row.event)}`
        const result = await this.sendBroadcast(row.tenant_id, row.channel, text)
        if (result.ok) {
          await this.finish(trx, [row.id], "sent")
          sent += 1
        } else {
          await this.retryOrFail(trx, row.id, row.attempts, result.detail)
        }
      }
      return sent
    })
  }

  private async sendBroadcast(
    tenantId: number,
    channel: string,
    text: string,
  ): Promise<{ ok: boolean; detail: string }> {
    if (!isChannelId(channel)) return { ok: false, detail: `未知的通道 ${channel}` }
    try {
      return await this.sender.send(tenantId, channel, text)
    } catch (error) {
      /* 通道被移除憑證 / 設定不全時 sender 會拋 —— 這是**設定問題不是暫時性失敗**,
         但仍走重試路徑:管理者補上設定後,下一輪就會送出去。 */
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  private async sendGroup(trx: Knex, rows: readonly DueRow[]): Promise<number> {
    const head = rows[0]
    if (head === undefined) return 0
    const ids = rows.map((r) => r.id)

    if (head.email === null || head.email === "") {
      await this.finish(trx, ids, "skipped", "收件人無 email")
      return 0
    }

    /* **寄送前必查抑制清單**(FMEA N15)—— 硬退 / 投訴過的位址一律不再寄,
       否則投訴率會推向 Google 的 0.3% 紅線,拖垮整個平台的送達率。 */
    const suppressed = await trx
      .table("email_suppression")
      .where("email", head.email)
      .first<{ reason: string } | undefined>("reason")
    if (suppressed !== undefined) {
      await this.finish(trx, ids, "skipped", `已抑制:${suppressed.reason}`)
      return 0
    }

    const subject =
      rows.length === 1
        ? `${head.title} · ${eventText(head.event)}`
        : `${head.title} · ${rows.length} 則更新`
    /* **內文一律不含欄位值**(OQ-NT-9)—— Email 會離開系統,而欄位級權限
       使業界主流的「過濾收件人」在此模型下失效。只有誰/何時/哪一筆。 */
    const body = [
      rows.length === 1 ? `${head.title} ${eventText(head.event)}。` : `${head.title} 有以下更新:`,
      ...(rows.length === 1 ? [] : rows.map((r) => `· ${eventText(r.event)}`)),
      "",
      "請登入 Weyver 查看詳細內容。",
    ].join("\n")

    const result = await this.email.send({
      to: head.email,
      subject,
      body,
      threadKey: `t${head.tenant_id}-f${head.form_id}-r${head.record_id}`,
      unsubscribeUrl: null,
    })

    if (result.outcome === "sent") {
      await this.finish(trx, ids, "sent")
      return ids.length
    }
    if (result.outcome === "skipped") {
      await this.finish(trx, ids, "skipped", result.detail)
      return 0
    }
    if (result.outcome === "hard_fail") {
      /* 5xx 永久失敗 → **立即永久 suppress**,不重試 */
      await trx
        .table("email_suppression")
        .insert({ email: head.email, reason: "hard_bounce", detail: result.detail ?? null })
        .onConflict("email")
        .ignore()
      await this.finish(trx, ids, "failed", result.detail)
      return 0
    }
    /* 軟失敗 → 指數退避;連續失敗達上限升級為硬失敗(不無限重試耗信譽) */
    const attempts = head.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      await this.finish(trx, ids, "failed", `重試 ${attempts} 次仍失敗:${result.detail ?? ""}`)
      return 0
    }
    const backoffMin = 2 ** attempts
    await trx
      .table("notification_delivery")
      .whereIn("id", ids)
      .update({
        attempts,
        last_error: result.detail ?? null,
        next_attempt_at: trx.raw(`now() + interval '${backoffMin} minutes'`),
      })
    return 0
  }

  /* 廣播的重試:與 email 同一套指數退避與上限,但沒有 suppression 的概念
     (對方是一個頻道,不是一個會硬退的信箱)。 */
  private async retryOrFail(
    trx: Knex,
    id: number,
    prevAttempts: number,
    detail: string,
  ): Promise<void> {
    const attempts = prevAttempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      await this.finish(trx, [id], "failed", `重試 ${String(attempts)} 次仍失敗:${detail}`)
      return
    }
    const backoffMin = 2 ** attempts
    await trx
      .table("notification_delivery")
      .where("id", id)
      .update({
        attempts,
        last_error: detail,
        next_attempt_at: trx.raw(`now() + interval '${String(backoffMin)} minutes'`),
      })
  }

  private async finish(
    trx: Knex,
    ids: readonly number[],
    status: string,
    detail?: string,
  ): Promise<void> {
    await trx
      .table("notification_delivery")
      .whereIn("id", [...ids])
      .update({
        status,
        last_error: detail ?? null,
        sent_at: status === "sent" ? trx.fn.now() : null,
      })
  }
}

/* 建立 email delivery 時的延遲分鐘數:關鍵事件立即(0),其餘等去抖動視窗。

   **回傳分鐘數而非時刻** —— 排程時刻一律由 DB 的 `now()` 計算,
   避免應用時鐘與資料庫時鐘偏差造成提早寄送或永遠不到期(整合測實際踩到)。
   單一時鐘來源是排程正確性的前提。 */
export function emailDelayMinutes(event: string): number {
  return isApprovalEvent(event) ? 0 : COALESCE_IDLE_MINUTES
}

function eventText(event: string): string {
  const map: Record<string, string> = {
    "approval.pending": "待您簽核",
    "approval.approved": "已核准",
    "approval.rejected": "已駁回",
    "approval.overdue": "簽核逾期",
    "record.created": "新增資料",
    "record.updated": "資料已更新",
  }
  return map[event] ?? event
}
