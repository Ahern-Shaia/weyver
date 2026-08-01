import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression, Interval } from "@nestjs/schedule"
import { STORAGE_DRIVER, type StorageDriver } from "../storage/storage-driver.js"
import { ExportRunnerService } from "./export-runner.service.js"
import { ExportRepository } from "./export.repository.js"

/* R1·I-1 M1|匯出佇列的 worker(OQ-EX-1=A)。

   ## 為什麼是輪詢而不是 BullMQ

   見 migration 0046 檔頭:本專案目前沒有任何背景工作,為單一功能引入 Redis
   等於同時引入一整套新的失效模式。`export_job` 的狀態欄就是佇列。

   ## 一次只跑一個

   匯出會把整個租戶掃一遍,平行跑多個等於自己對自己發動壓力測試。
   `running` 旗標由 `claimNext()` 的 `FOR UPDATE SKIP LOCKED` 原子取得,
   多實例部署時也不會有兩個 worker 撿到同一列。

   ## 🔴 失敗訊息不外洩內部細節

   `error` 欄會直接顯示給使用者。原始例外可能含 SQL、路徑、堆疊 ——
   OWASP Logging 禁記清單同一個道理:給人看的與給工程師看的是兩份東西。 */
@Injectable()
export class ExportWorkerService {
  private readonly logger = new Logger(ExportWorkerService.name)
  private busy = false

  constructor(
    @Inject(ExportRepository) private readonly repo: ExportRepository,
    @Inject(ExportRunnerService) private readonly runner: ExportRunnerService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  @Interval(5_000)
  async tick(): Promise<void> {
    /* 上一輪還在跑就跳過 —— `@Interval` 不會等前一次結束,
       不擋的話一個慢工作會被重複啟動。 */
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
    const job = await this.repo.claimNext()
    if (job === null) return false
    try {
      await this.runner.run(job)
    } catch (error) {
      const message = userFacingError(error)
      /* 完整原因進應用日誌(給工程師),使用者只看到轉譯過的那一句 */
      this.logger.error(`匯出 #${String(job.id)} 失敗`, error instanceof Error ? error.stack : "")
      await this.repo.markFailed(job.id, message)
    }
    return true
  }

  /* 🔴 到期清理。**刪的是 storage 物件,列留著標 expired** ——
     「誰在什麼時候把整包公司資料帶走了」是內控要問的問題,那筆紀錄不能跟著檔案一起消失。

     每小時一次即可:保存期是 7 天,晚一小時清掉不構成風險,
     但每分鐘掃一次會在沒有到期物件時白跑 1440 次。 */
  /* 具名是硬性要求:未具名的 cron 以 UUID 進 registry,重複註冊就偵測不到
     (`schedule-registration.integration.test` 釘住,加這支時它立刻轉紅)。 */
  @Cron(CronExpression.EVERY_HOUR, { name: "export.expire" })
  async expire(): Promise<void> {
    const due = await this.repo.expireDue(new Date())
    for (const row of due) {
      /* 刪不掉也要把列標成 expired(repo 已經做了)—— 否則下載端點會放行一個
         其實還在的檔案,或反過來一直重試同一列。孤兒物件由儲存層的生命週期規則收。 */
      await this.storage.delete(row.objectKey).catch((error: unknown) => {
        this.logger.error(
          `匯出 #${String(row.id)} 的封存檔刪除失敗`,
          error instanceof Error ? error.stack : "",
        )
      })
    }
    if (due.length > 0) this.logger.log(`已清理 ${String(due.length)} 份到期封存檔`)
  }
}

function userFacingError(error: unknown): string {
  if (error instanceof Error && error.message === "EXPORT_TOO_LARGE") {
    return "資料量超過單次匯出上限,請改為分批選擇表單匯出"
  }
  return "匯出失敗,請稍後再試;若持續發生請聯繫服務窗口"
}
