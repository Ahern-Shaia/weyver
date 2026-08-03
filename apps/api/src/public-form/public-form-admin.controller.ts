import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import { RecordService } from "../form-engine/records/record.service.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { PublicFormService, publicSafeTypes } from "./public-form.service.js"

/* G-2|公開表單的**內部**管理面。與訪客路徑分開成兩個 controller,
   因為兩者的守衛完全不同 —— 混在一起遲早會有人把 admin 端點漏掉守衛。 */

const createShareSchema = z.object({
  formId: z.number().int().positive(),
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  fieldIds: z.array(z.number().int().positive()).min(1),
  closesAt: z.string().datetime().optional(),
  maxSubmissions: z.number().int().min(1).max(1_000_000).optional(),
})

const rejectSchema = z.object({ reason: z.string().min(1).max(500) })

@Controller("api/public-forms")
@UseGuards(TenantGuard, PermissionGuard)
export class PublicFormAdminController {
  constructor(
    @Inject(PublicFormService) private readonly forms: PublicFormService,
    @Inject(RecordService) private readonly records: RecordService,
  ) {}

  /* 開放一張表單給外部人填寫是**租戶級的安全決定**,不是表單級功能 → 限 admin。 */
  private assertAdmin(permissions: EffectivePermissions): void {
    if (!permissions.isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "公開表單設定需要管理員權限" })
    }
  }

  /* 可公開的欄位型別。**由後端回**,前端不自己維護一份 ——
     兩份清單會漂移,而症狀是使用者挑得到一個必定失敗的欄位。
     不含權限資訊,但仍走 admin 閘門與其餘端點一致。 */
  @Get("safe-types")
  safeTypes(@Permissions() permissions: EffectivePermissions): { types: readonly string[] } {
    this.assertAdmin(permissions)
    return { types: publicSafeTypes() }
  }

  @Get()
  async list(@Tenant() tenant: TenantContext, @Permissions() permissions: EffectivePermissions) {
    this.assertAdmin(permissions)
    return { shares: await this.forms.list(tenant.tenantId) }
  }

  @Post()
  async create(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(createShareSchema)) body: z.infer<typeof createShareSchema>,
  ) {
    this.assertAdmin(permissions)
    /* token 只在這一次回傳(與 webhook secret / API 金鑰同一原則) */
    return this.forms.create(tenant.tenantId, tenant.actorId, {
      formId: body.formId,
      title: body.title,
      description: body.description,
      fieldIds: body.fieldIds,
      closesAt: body.closesAt === undefined ? undefined : new Date(body.closesAt),
      maxSubmissions: body.maxSubmissions,
    })
  }

  @Post(":id/close")
  @HttpCode(204)
  async close(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.forms.setActive(tenant.tenantId, id, false)
  }

  @Post(":id/open")
  @HttpCode(204)
  async open(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.forms.setActive(tenant.tenantId, id, true)
  }

  @Get("inbox")
  async inbox(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Query("status") status?: string,
  ) {
    this.assertAdmin(permissions)
    return { submissions: await this.forms.inbox(tenant.tenantId, status ?? "pending") }
  }

  /* 🔴 promote 才是資料真正進入系統的那一刻。

     此時才:取正式編號、跑公式、觸發簽核 / 通知 / webhook。
     建立者記為**執行 promote 的人**而非匿名者 —— 是他決定讓這筆資料進來的,
     責任歸屬要跟著決定走。原始提交者資訊留在 public_submission 供追溯。 */
  @Post("inbox/:id/promote")
  async promote(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ) {
    this.assertAdmin(permissions)
    const submission = await this.forms.getPending(tenant.tenantId, id)
    if (submission === null) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "找不到待審的提交" })
    }
    const record = await this.records.createRecord(
      tenant.tenantId,
      submission.formId,
      submission.values as Record<string, unknown>,
      tenant.actorId,
    )
    await this.forms.markReviewed(
      tenant.tenantId,
      id,
      { status: "promoted", recordId: record.id },
      tenant.actorId,
    )
    return { recordId: record.id }
  }

  @Post("inbox/:id/reject")
  @HttpCode(204)
  async reject(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.forms.markReviewed(
      tenant.tenantId,
      id,
      { status: "rejected", reason: body.reason },
      tenant.actorId,
    )
  }
}
