import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { FastifyReply } from "fastify"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import { SelfService } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { RequestWithTenant, TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { ExportDownloadService } from "./export-download.service.js"
import { type ExportJobDto, ExportService } from "./export.service.js"

/* R1·I-1 M2|資料匯出 API。

   ## 🔴 為什麼 POST 回 202 而不是 201

   RFC 9110 §15.3.3 逐字:「The 202 (Accepted) status code indicates that the request
   has been accepted for processing, but the **processing has not been completed**.」
   且「SHOULD include information about the request's current status and either a
   **pointer to a status monitor**」—— 回應裡的 job 資源就是那個 status monitor。

   回 201 會說「已建立」,而使用者真正在意的東西(封存檔)那時候還不存在。

   ## 授權

   `@SelfService()`:本端點沒有 :formId,而 PermissionGuard 對「無 formId 的寫入」
   預設要求 admin —— 那條規則是為了擋建表的。匯出的實際範圍**在 runner 裡逐表
   過 `export` 權**(見 export-runner.service.ts),不是在這裡放行就全給。

   ## 節流

   建立匯出會排入一個掃全租戶的工作 → 比一般寫入更嚴的節流,
   再加上 service 的每日上限與 DB 的「同時只有一個」。三層各擋不同的東西:
   節流擋瞬間洪水、每日上限擋接力、唯一索引擋並行。 */

/* 密碼只在 body,不進 URL */
const downloadSchema = z.object({ password: z.string().max(200).optional() })

const createSchema = z.object({
  /* 不指定 = 全部(仍逐表過權)。空陣列由 service 明確拒絕,不靜默當成全部。 */
  formIds: z.array(z.number().int().positive()).max(500).optional(),
  includeAttachments: z.boolean().optional(),
})

@Controller("api/exports")
@UseGuards(TenantGuard, PermissionGuard)
export class ExportsController {
  constructor(
    @Inject(ExportService) private readonly exports: ExportService,
    @Inject(ExportDownloadService) private readonly downloads: ExportDownloadService,
  ) {}

  @Get()
  async list(@Tenant() tenant: TenantContext): Promise<{ jobs: ExportJobDto[]; ttlDays: number }> {
    return this.exports.list(tenant)
  }

  @Get(":id")
  async get(
    @Tenant() tenant: TenantContext,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<ExportJobDto> {
    const job = await this.exports.get(tenant, id)
    if (job === null)
      throw new NotFoundException({ code: "EXPORT_NOT_FOUND", message: "找不到此匯出" })
    return job
  }

  @Post()
  @SelfService()
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ): Promise<ExportJobDto> {
    return this.exports.create(tenant, body)
  }

  /* 🔴 下載是 **POST** 而非 GET —— 它要帶密碼(ASVS §7.5.3 的再認證),
     而密碼不能放在 URL 裡(會進瀏覽器歷史、存取日誌、Referer)。
     能簽名就把簽名 URL 交給呼叫端自己去取(位元組不經應用層),不能就代理串流。

     ## 🔴 為什麼簽名分支回 200 JSON 而不是 302(M4 改)

     M3 原本回 `302 + Location`。那對 curl 成立,對**瀏覽器**不成立:
     這個端點是 POST(要帶密碼),故前端只能用 `fetch`,而 fetch 在 cors 模式下
     跟隨重導之後,**最終回應仍必須通過 CORS 檢查** —— 物件儲存桶預設不會
     對我方網域回 `Access-Control-Allow-Origin`,下載會直接失敗。

     而這條路徑在 dev 與測試裡**完全不會執行**(local driver 無 `presign`),
     所以它是一個「測試永遠綠、只有 prod 會壞」的形狀 —— 本模組已經踩過同型兩次
     (`ZipArchive` 執行期不存在 / archiver 的 CJS interop)。

     回 JSON 讓呼叫端改用**導航**(`window.location`)去取簽名 URL:
     導航不受 CORS 管,不必為此在儲存桶上開一個對外的 CORS 設定,
     且簽名本身已帶 `Content-Disposition: attachment`,瀏覽器會直接存檔。 */
  @Post(":id/download")
  @SelfService()
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async download(
    @Tenant() tenant: TenantContext,
    @Req() request: RequestWithTenant,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("id", ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(downloadSchema)) body: z.infer<typeof downloadSchema>,
  ): Promise<StreamableFile | { url: string }> {
    const result = await this.downloads.authorize(tenant, request, id, body.password)
    if ("url" in result) {
      /* 簽名 URL 有時效且對應單一次授權結果 —— 絕不可被任何快取層留存 */
      reply.header("cache-control", "no-store, private")
      return { url: result.url }
    }
    reply.header("content-type", "application/zip")
    reply.header("content-disposition", `attachment; filename="${result.filename}"`)
    reply.header("content-length", String(result.size))
    reply.header("cache-control", "no-store, private")
    return new StreamableFile(result.stream)
  }
}
