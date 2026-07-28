import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common"
import type { FastifyReply, FastifyRequest } from "fastify"
import { Throttle } from "@nestjs/throttler"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { type FileDto, contentDisposition } from "./file-specs.js"
import { FilesService } from "./files.service.js"

/* @fastify/multipart 之 request.file();此處只取單檔(欄位多檔由前端逐檔上傳)。 */
interface MultipartFile {
  readonly filename: string
  readonly file: { readonly truncated: boolean }
  toBuffer(): Promise<Buffer>
}
type MultipartRequest = FastifyRequest & {
  isMultipart(): boolean
  file(options?: { limits?: { fileSize?: number } }): Promise<MultipartFile | undefined>
}

/* F-5 M2 上傳(路由帶 :formId → PermissionGuard 可直接驗表單 edit;欄位級 write 於 service 驗)。 */
@Controller("api/forms/:formId/files")
@UseGuards(TenantGuard, PermissionGuard)
export class FormFilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  /* 🔴 上傳專用限流。

     全域 throttler 為 300 req/60s,而本端點以 `part.toBuffer()` 把**整檔讀進記憶體**
     (為了在落儲存前驗 magic bytes,OQ-FS-2)。單一 IP 一分鐘即可推
     300 × 20MB ≈ 6GB 進堆積體 → 容器 OOM。

     **60/min 是校準過的值,不是隨手取的**:圖片欄本身允許每欄 20 張、
     Ragic 亦有「多筆檔案上傳」,批次附檔是正常操作 —— 初版設 20/min 立刻
     打到既有整合測(剛好 20 次上傳),證明對真實使用過緊。
     60/min 仍把單 IP 最壞情況由 ~6GB/min 壓到 ~1.2GB/min。 */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post()
  @RequiresFormAction("edit")
  async upload(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Query("fieldId", ParseIntPipe) fieldId: number,
    @Req() request: FastifyRequest,
  ): Promise<FileDto> {
    const multipart = request as MultipartRequest
    if (!multipart.isMultipart()) {
      throw new BadRequestException({ code: "NOT_MULTIPART", message: "需以 multipart 上傳" })
    }
    const max = this.files.maxFileBytes()
    const part = await multipart.file({ limits: { fileSize: max } })
    if (part === undefined) {
      throw new BadRequestException({ code: "NO_FILE", message: "未附檔案" })
    }
    const body = await part.toBuffer()
    // multipart 於超限時截斷而非拋錯 → 明示拒絕,不存半截檔(FMEA S5)
    if (part.file.truncated) {
      throw new PayloadTooLargeException({
        code: "FILE_TOO_LARGE",
        message: `檔案超過上限 ${max / 1024 / 1024} MB`,
      })
    }
    return this.files.upload(tenant, permissions, formId, fieldId, part.filename, body)
  }
}

/* F-5 M2 下載 / 刪除。路由無 :formId(key 才知道屬哪張表)→ guard 層放行至 view,
   真正授權於 service 回查 metadata 後執行(key 非憑證,OQ-FS-4 / FMEA S1)。
   key 含斜線 → 拆三段對應 t{tenant}/f{form}/{uuid}{ext},重組後再驗形狀。 */
@Controller("api/files")
@UseGuards(TenantGuard, PermissionGuard)
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Get(":tenantSeg/:formSeg/:objectName")
  @RequiresFormAction("view")
  async download(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("tenantSeg") tenantSeg: string,
    @Param("formSeg") formSeg: string,
    @Param("objectName") objectName: string,
    @Query("variant") variant: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const { stream, meta } = await this.files.openForDownload(
      tenant,
      permissions,
      `${tenantSeg}/${formSeg}/${objectName}`,
      variant === "thumb" ? "thumb" : undefined,
    )
    // 保守 Content-Type + 一律 attachment(不 inline)→ 防 HTML/SVG XSS(docs/22;nosniff 已於 onSend)
    reply.header("content-type", "application/octet-stream")
    reply.header("content-disposition", contentDisposition(meta.name))
    reply.header("content-length", String(meta.size))
    return new StreamableFile(stream)
  }

  @Delete(":tenantSeg/:formSeg/:objectName")
  @RequiresFormAction("view")
  @HttpCode(204)
  async remove(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("tenantSeg") tenantSeg: string,
    @Param("formSeg") formSeg: string,
    @Param("objectName") objectName: string,
  ): Promise<void> {
    await this.files.remove(tenant, permissions, `${tenantSeg}/${formSeg}/${objectName}`)
  }
}
