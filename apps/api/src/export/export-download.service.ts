import type { Readable } from "node:stream"
import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common"
import { fromNodeHeaders } from "better-auth/node"
import type { Auth } from "../auth/auth.js"
import { AUTH } from "../auth/auth.tokens.js"
import type { RequestWithTenant } from "../http/tenant-context.js"
import type { TenantContext } from "../http/tenant-context.js"
import { STORAGE_DRIVER, type StorageDriver } from "../storage/storage-driver.js"
import { EXPORT_MAX_DOWNLOADS } from "./export-specs.js"
import { ExportRepository } from "./export.repository.js"

/* R1·I-1 M3|下載封存檔。

   ## 🔴 為什麼下載前要再認證一次

   OWASP ASVS 5.0 §7.5.3 逐字:「Verify that the application requires further
   authentication with at least one factor or secondary verification before
   performing **highly sensitive transactions or operations**.」

   一次取得整個公司的資料就是那個「highly sensitive operation」——
   session 被盜時,它是損失最大的那一個端點。成本只是一個對話框。

   ⚠️ **證據校正**|先前記述「Google Takeout 下載時要求重新輸入密碼」。
   回頭逐字複查該頁時**復現不出那句話**(只找得到安全性理由的敘述與
   「We only allow each archive to be downloaded 5 times」)。故本設計改以
   ASVS §7.5.3 為依據,不再引用該說法。

   ## 為什麼用 Better Auth 的 `/verify-password` 而不是自己比對

   密碼雜湊參數(Argon2id)、時序安全、錯誤語意都在框架那一側。
   自己撈 hash 來比等於把三件容易出錯的事重做一遍。

   ## dev 車道沒有 session 可驗

   `x-dev-tenant` 沒有真實使用者,自然沒有密碼可以驗。此時**略過再認證** ——
   這不是降級,而是那條車道本來就沒有身分可言(整個 dev lane 皆然)。
   prod 兩條路都走 AuthGuard,一定有 `authUserId`。 */
@Injectable()
export class ExportDownloadService {
  constructor(
    @Inject(ExportRepository) private readonly repo: ExportRepository,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  /* 回 presigned URL(driver 支援時)或可串流的位元組。
     呼叫端據此回 JSON 讓瀏覽器導航過去,或代理串流(理由見 controller)。 */
  async authorize(
    tenant: TenantContext,
    request: RequestWithTenant,
    id: number,
    password: string | undefined,
  ): Promise<{ url: string } | { stream: Readable; size: number; filename: string }> {
    await this.reauthenticate(request, password)

    const claimed = await this.repo.claimDownload(tenant.tenantId, id, EXPORT_MAX_DOWNLOADS)
    if (claimed === null) await this.explainFailure(tenant, id)

    const key = claimed?.objectKey ?? ""
    const filename = `weyver-export-${String(id)}.zip`
    const signed = await this.storage.presign?.(key, {
      ttlSeconds: 60,
      filename,
      mime: "application/zip",
    })
    if (signed !== null && signed !== undefined) return { url: signed }

    const stat = await this.storage.stat(key)
    const stream = await this.storage.get(key)
    return { stream, size: stat?.size ?? 0, filename }
  }

  private async reauthenticate(
    request: RequestWithTenant,
    password: string | undefined,
  ): Promise<void> {
    const authUserId = request.authUserId
    if (authUserId === undefined) return

    if (password === undefined || password === "") {
      throw new ForbiddenException({
        code: "EXPORT_REAUTH_REQUIRED",
        message: "下載整包資料前請再輸入一次密碼",
      })
    }
    const ok = await this.auth.api
      .verifyPassword({ body: { password }, headers: fromNodeHeaders(request.headers) })
      .catch(() => ({ status: false }))
    if (ok.status !== true) {
      throw new ForbiddenException({
        code: "EXPORT_REAUTH_FAILED",
        /* 不區分「密碼錯」與「這個帳號沒有密碼」—— 兩者的差別對攻擊者才有價值 */
        message: "密碼不正確",
      })
    }
  }

  /* 條件式 UPDATE 影響 0 列時,回查是哪一個條件不成立。
     只有這一步允許多一次查詢 —— 錯誤訊息說不清楚的話,使用者只會反覆重按。 */
  private async explainFailure(tenant: TenantContext, id: number): Promise<never> {
    const row = await this.repo.getForTenant(tenant.tenantId, id)
    if (row === null) {
      throw new NotFoundException({ code: "EXPORT_NOT_FOUND", message: "找不到此匯出" })
    }
    if (row.status === "expired" || (row.expiresAt !== null && row.expiresAt <= new Date())) {
      throw new GoneException({
        code: "EXPORT_EXPIRED",
        message: "此封存檔已過期,請重新建立一次匯出",
      })
    }
    if (row.downloadCount >= EXPORT_MAX_DOWNLOADS) {
      throw new GoneException({
        code: "EXPORT_DOWNLOAD_LIMIT",
        message: `每份封存檔限下載 ${String(EXPORT_MAX_DOWNLOADS)} 次,請重新建立一次匯出`,
      })
    }
    throw new NotFoundException({
      code: "EXPORT_NOT_READY",
      message: "此匯出尚未完成,請稍候再試",
    })
  }
}
