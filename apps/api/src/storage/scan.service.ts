import { createHash } from "node:crypto"
import { Inject, Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Cron, CronExpression } from "@nestjs/schedule"
import type { Knex } from "knex"
import { DDL_KNEX } from "../db/db.module.js"
import { STORAGE_DRIVER, type StorageDriver } from "./storage-driver.js"
import { type ClamOptions, type ClamVerdict, ping, scanBuffer } from "./clamav-client.js"

/* 🔴 F-11 M4|補掃。

   ## 兩段式的第二段

   上傳當下先同步掃一次(4 秒逾時);逾時或 clamd 不可用時檔案留在 `pending`,
   由這支 cron 收拾。純靠 cron 的話,公開表單的填寫者送出後要等一分鐘才知道
   附件能不能用 —— 體驗不可接受。

   ## 為什麼是 cron 而不是佇列

   與 G-1 同一判斷:BullMQ / DBOS 都沒安裝,而 `notification_delivery`
   的「cron 抽取 + 退避欄位」模式已在 prod 路徑驗證過。少一個依賴、少一個故障面。

   ## 🔴 sha256 綁定

   掃的是 hash X、放行的必須也是 hash X。ESET **CA8840** 即真實的 TOCTOU
   換 handle 案例。本平台的物件是不可變的(隨機 key、寫入後不改),
   但仍明確比對 —— 不變性是靠約定維持的,而約定會被改。 */

const BATCH_LIMIT = 20
const MAX_ATTEMPTS = 5
const SCAN_LOCK_KEY = 909_005
/* 退避(分鐘)。clamd 冷啟載入簽章庫可能數分鐘,前幾次退避刻意短。 */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240] as const

interface DueRow {
  key: string
  tenant_id: string | number
  mime: string
  sha256: string | null
  scan_attempts: number
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name)

  constructor(
    @Inject(DDL_KNEX) private readonly knex: Knex,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>("MALWARE_SCAN_MODE") === "required"
  }

  private opts(timeoutMs: number): ClamOptions {
    return {
      host: this.config.get<string>("MALWARE_SCAN_HOST") ?? "127.0.0.1",
      port: this.config.get<number>("MALWARE_SCAN_PORT") ?? 3310,
      timeoutMs,
    }
  }

  /* 上傳路徑呼叫。逾時不擲錯 —— **接受端 fail-open**:上傳成功、留 pending,
     由 cron 收拾。供應端(下載閘)才 fail-closed。 */
  async scanInline(body: Buffer): Promise<ClamVerdict | null> {
    if (!this.enabled) return null
    const timeout = this.config.get<number>("MALWARE_SCAN_INLINE_TIMEOUT_MS") ?? 4000
    const verdict = await scanBuffer(body, this.opts(timeout))
    return verdict.status === "error" ? null : verdict
  }

  async isReachable(): Promise<boolean> {
    return this.enabled ? ping(this.opts(2000)) : false
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: "file.scan" })
  async scheduled(): Promise<void> {
    if (!this.enabled) return
    try {
      const result = await this.run()
      if (result.scanned > 0) this.logger.log(`file scan: ${JSON.stringify(result)}`)
    } catch (error) {
      this.logger.error(
        `file scan failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async run(): Promise<{ scanned: number; infected: number; skipped: boolean }> {
    const gate = await this.knex.raw<{ rows: { locked: boolean }[] }>(
      "SELECT pg_try_advisory_lock(?) AS locked",
      [SCAN_LOCK_KEY],
    )
    if (gate.rows[0]?.locked !== true) return { scanned: 0, infected: 0, skipped: true }
    try {
      const due = await this.claim()
      let infected = 0
      for (const row of due) {
        const verdict = await this.scanOne(row)
        if (verdict === "infected") infected += 1
      }
      return { scanned: due.length, infected, skipped: false }
    } finally {
      await this.knex.raw("SELECT pg_advisory_unlock(?)", [SCAN_LOCK_KEY])
    }
  }

  /* 跨租戶維運 → 特權車道。已刪除的不掃(省得白費工)。 */
  private async claim(): Promise<DueRow[]> {
    const { rows } = await this.knex.raw<{ rows: DueRow[] }>(
      `SELECT key, tenant_id, mime, sha256, scan_attempts
         FROM file_object
        WHERE scan_status IN ('pending','error')
          AND deleted_at IS NULL
          AND scan_attempts < ?
          AND (scan_next_attempt_at IS NULL OR scan_next_attempt_at <= now())
        ORDER BY created_at
        LIMIT ?`,
      [MAX_ATTEMPTS, BATCH_LIMIT],
    )
    return rows
  }

  private async scanOne(row: DueRow): Promise<ClamVerdict["status"] | "gone"> {
    let body: Buffer
    try {
      const stream = await this.storage.get(row.key)
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      body = Buffer.concat(chunks)
    } catch {
      /* 物件不在了(已被回收 / 從未寫成功)→ 不再重試,標 error 收斂。
         留著一直重試只會讓佇列永遠不空。 */
      await this.finish(row, "error", { detail: "物件不存在" }, true)
      return "gone"
    }

    /* 🔴 掃的與存的必須是同一份位元組 */
    const actual = createHash("sha256").update(body).digest("hex")
    if (row.sha256 !== null && row.sha256 !== actual) {
      await this.finish(row, "error", { detail: "檔案內容與上傳時的雜湊不符" }, true)
      return "error"
    }

    const timeout = this.config.get<number>("MALWARE_SCAN_BATCH_TIMEOUT_MS") ?? 60_000
    const verdict = await scanBuffer(body, this.opts(timeout))

    if (verdict.status === "clean") {
      await this.finish(row, "clean", {})
      return "clean"
    }
    if (verdict.status === "infected") {
      /* 🔴 不刪檔 —— 留供鑑識。記下簽章名、引擎與簽章庫版本,
         稽核時要說得出「什麼時候、用什麼版本、判成什麼」。 */
      await this.finish(row, "infected", { detail: verdict.signature })
      this.logger.warn(`infected file ${row.key}: ${verdict.signature}`)
      return "infected"
    }
    await this.finish(row, "error", { detail: verdict.detail })
    return "error"
  }

  private async finish(
    row: DueRow,
    status: "clean" | "infected" | "error",
    info: { detail?: string },
    terminal = false,
  ): Promise<void> {
    const attempts = row.scan_attempts + 1
    const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 240
    await this.knex("file_object")
      .where({ key: row.key })
      .update({
        scan_status: status,
        scan_attempts: attempts,
        scan_engine: "clamav",
        scan_detail: info.detail ?? null,
        scanned_at: this.knex.fn.now(),
        /* error 才排重試;clean / infected 是終局。
           terminal=true 代表這個 error 不值得重試(物件不在、雜湊不符)。 */
        scan_next_attempt_at:
          status === "error" && !terminal
            ? this.knex.raw(`now() + interval '${String(backoff)} minutes'`)
            : null,
      })
  }
}
