import type { Readable } from "node:stream"
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
  Res,
  UseGuards,
} from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { FastifyReply } from "fastify"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { PdfMergeSkip } from "../db/schema.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { STORAGE_DRIVER, type StorageDriver } from "../storage/storage-driver.js"
import { PdfService } from "./pdf.service.js"

const createSchema = z.object({
  formId: z.number().int().positive(),
  recordIds: z.array(z.number().int().positive()).min(1).max(200),
  /* M2 A3|把記錄的附件 PDF 併進單據。**預設關** —— 「印一張採購單」與
     「把這張單所有附件一起交出去」是兩個不同的意圖。 */
  mergeAttachments: z.boolean().default(false),
})

interface JobDto {
  id: number
  status: string
  sizeBytes: number | null
  recordCount: number
  error: string | null
  createdAt: string
  readyAt: string | null
  /* null = 這次沒要求合併;`[]` = 有合併且全部成功。兩者不可混為一談,
     否則沒有附件的單據會被顯示成「附件全部略過」。 */
  mergeReport: readonly PdfMergeSkip[] | null
}

/* 🔴 R1·後續-2b M1|單據 PDF。

   ## 為什麼票的核銷端點**不掛 Guard**

   `GET /api/pdf/render/:ticket` 的呼叫者是渲染器 —— 一個沒有 session 的瀏覽器。
   它的身分**就是那張票**:單次、60 秒、只在 worker 行程裡出現過。
   核銷成功之後,資料以**該工作 actor** 的有效權限讀出(見 `PdfService.redeem`),
   所以「沒有身分」不等於「沒有權限限制」—— 限制在票背後的那個人身上。

   ⚠️ 這是本模組唯一一個不經 `AuthGuard` 的端點,故:
   · 票只存雜湊,核銷是條件更新(用過即失效,無競態窗)
   · 端點掛嚴格 throttle —— 它是唯一可以無身分呼叫的入口
   · 失敗一律回同一個 404,不區分「票不存在」與「票用過了」 */
@Controller("api/pdf")
export class PdfController {
  constructor(
    @Inject(PdfService) private readonly pdf: PdfService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  @Post()
  @HttpCode(200)
  @UseGuards(TenantGuard, PermissionGuard)
  async create(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ): Promise<JobDto> {
    const job = await this.pdf.createJob(
      tenant.tenantId,
      tenant.actorId,
      body.formId,
      body.recordIds,
      permissions,
      body.mergeAttachments,
    )
    return toDto(job)
  }

  @Get("jobs")
  @UseGuards(TenantGuard, PermissionGuard)
  async list(@Tenant() tenant: TenantContext): Promise<JobDto[]> {
    const jobs = await this.pdf.listOwn(tenant.tenantId, tenant.actorId)
    return jobs.map(toDto)
  }

  @Get("jobs/:id")
  @UseGuards(TenantGuard, PermissionGuard)
  async get(
    @Tenant() tenant: TenantContext,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<JobDto> {
    const job = await this.pdf.findOwn(tenant.tenantId, tenant.actorId, id)
    if (job === null) throw new NotFoundException({ code: "NOT_FOUND", message: "找不到這個工作" })
    return toDto(job)
  }

  @Get("jobs/:id/download")
  @UseGuards(TenantGuard, PermissionGuard)
  async download(
    @Tenant() tenant: TenantContext,
    @Param("id", ParseIntPipe) id: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Readable> {
    const job = await this.pdf.findOwn(tenant.tenantId, tenant.actorId, id)
    if (job === null || job.objectKey === null || job.status !== "ready") {
      throw new NotFoundException({ code: "NOT_FOUND", message: "檔案尚未產生或已過期" })
    }
    await this.pdf.countDownload(job.id)
    void reply.header("content-type", "application/pdf")
    /* filename 由伺服器決定,不含使用者輸入 —— header 注入的常見破口 */
    void reply.header("content-disposition", `attachment; filename="weyver-${String(job.id)}.pdf"`)
    return this.storage.get(job.objectKey)
  }

  /* 🔴 渲染器換資料。無 Guard —— 身分就是票本身,見類別註解。 */
  @Get("render/:ticket")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async render(@Param("ticket") ticket: string): Promise<unknown> {
    return this.pdf.redeem(ticket)
  }
}

function toDto(job: {
  id: number
  status: string
  sizeBytes: number | null
  recordIds: number[]
  error: string | null
  createdAt: Date
  readyAt: Date | null
  mergeReport: readonly PdfMergeSkip[] | null
}): JobDto {
  return {
    id: job.id,
    status: job.status,
    sizeBytes: job.sizeBytes,
    recordCount: job.recordIds.length,
    error: job.error,
    createdAt: new Date(job.createdAt).toISOString(),
    readyAt: job.readyAt === null ? null : new Date(job.readyAt).toISOString(),
    mergeReport: job.mergeReport,
  }
}
