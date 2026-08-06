import { randomBytes, randomUUID } from "node:crypto"
import { Inject, Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Cron, CronExpression, Interval } from "@nestjs/schedule"
import { STORAGE_DRIVER, type StorageDriver } from "../storage/storage-driver.js"
import { PDF_RENDERER, type PdfRenderer } from "./pdf-renderer.js"
import { PdfRepository } from "./pdf.repository.js"
import { PDF_TTL_DAYS, hashTicket } from "./pdf.service.js"

/* 🔴 R1·後續-2b M1|PDF 佇列 worker。形狀與 `ExportWorkerService` 一致 ——
   狀態欄就是佇列,`@Interval` 撿件,`busy` 旗標擋重入。

   **不為第二個功能引入 Redis**:那等於同時引入一整套新的失效模式,
   而 `export_job` 已經證明輪詢在這個規模夠用。

   ## 🔴 失敗訊息不外洩內部細節

   `error` 欄會直接顯示給使用者,而渲染失敗的原始例外可能含網址、
   堆疊、甚至頁面內容。給人看的與給工程師看的是兩份東西。 */
@Injectable()
export class PdfWorkerService {
  private readonly logger = new Logger(PdfWorkerService.name)
  private busy = false

  constructor(
    @Inject(PdfRepository) private readonly repo: PdfRepository,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Interval(5_000)
  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.drainOne()
    } finally {
      this.busy = false
    }
  }

  /* 測試直接呼叫這一支,不必等計時器。 */
  async drainOne(): Promise<boolean> {
    /* 🔴 票在**這一行**產生,而且只活在這個函式的區域變數裡 ——
       不進 API 回應、不進資料庫明文、不跨行程。撿件與寫入票雜湊是同一個
       UPDATE,所以多實例部署下也不會發生「A 發票 B 渲染」。 */
    const ticket = randomBytes(32).toString("base64url")
    const job = await this.repo.claimNext(hashTicket(ticket))
    if (job === null) return false

    try {
      const base = this.config.get<string>("PRINT_BASE_URL") ?? "http://localhost:3002"
      const pdf = await this.renderer.render({ url: `${base}/print/${ticket}` })
      const key = `t${String(job.tenantId)}/pdf/${randomUUID()}.pdf`
      await this.storage.put(key, pdf, { mime: "application/pdf" })
      await this.repo.markReady(job.id, key, pdf.byteLength, PDF_TTL_DAYS)
    } catch (error) {
      this.logger.warn(`PDF #${String(job.id)} 失敗:${String(error)}`)
      await this.repo.markFailed(job.id, "產生 PDF 失敗,請稍後再試或聯絡管理員")
    }
    return true
  }

  /* 🔴 到期清理。**刪 storage 物件,列留著標 expired** ——
     「誰在什麼時候把哪一筆資料印出來帶走了」是內控要問的問題,
     那筆紀錄不能跟著檔案一起消失。與 `export.expire` 同一個處置與同一個節奏。

     ⚠️ 具名是硬性要求:未具名的 cron 以 UUID 進 registry,重複註冊偵測不到
     (`schedule-registration` 測試釘住這件事)。 */
  @Cron(CronExpression.EVERY_HOUR, { name: "pdf.expire" })
  async expire(): Promise<void> {
    const due = await this.repo.expireDue(new Date())
    for (const row of due) {
      /* 刪不掉也已經標成 expired(repo 在同一個語句裡做了)—— 否則下載端點
         會放行一個其實已經該消失的檔案,或反過來一直重試同一列。
         孤兒物件由儲存層的生命週期規則收。 */
      await this.storage.delete(row.objectKey).catch((error: unknown) => {
        this.logger.error(
          `PDF #${String(row.id)} 的產出物刪除失敗`,
          error instanceof Error ? error.stack : "",
        )
      })
    }
    if (due.length > 0) this.logger.log(`已清理 ${String(due.length)} 份到期 PDF`)
  }
}
