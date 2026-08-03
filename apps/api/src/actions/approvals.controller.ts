import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common"
import type { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { SkipApprovalLock } from "./approval-lock.interceptor.js"
import { ApprovalService } from "./approval.service.js"
import {
  type ApprovalDefDto,
  type ApprovalInstanceDto,
  createApprovalDefBodySchema,
  addApproverBodySchema,
  decisionBodySchema,
} from "./action-specs.js"

/* R1·後續-1 M2 簽核定義 + 送簽(表單範圍;薄 controller)。 */
@Controller("api/forms/:formId/approvals")
@UseGuards(TenantGuard, PermissionGuard)
export class ApprovalsController {
  constructor(@Inject(ApprovalService) private readonly approvals: ApprovalService) {}

  @Get("defs")
  @RequiresFormAction("view")
  async listDefs(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<ApprovalDefDto[]> {
    return this.approvals.listDefs(tenant, formId)
  }

  @Post("defs")
  @RequiresFormAction("design")
  async createDef(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(createApprovalDefBodySchema))
    body: z.infer<typeof createApprovalDefBodySchema>,
  ): Promise<ApprovalDefDto> {
    return this.approvals.createDef(tenant, formId, body)
  }

  @Delete("defs/:defId")
  @RequiresFormAction("design")
  @HttpCode(204)
  async removeDef(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("defId", ParseIntPipe) defId: number,
  ): Promise<void> {
    await this.approvals.removeDef(tenant, formId, defId)
  }

  /* 送簽(需 edit 權:送簽改變記錄可編狀態)*/
  @SkipApprovalLock()
  @Post("records/:recordId/submit")
  @RequiresFormAction("edit")
  @HttpCode(200)
  async submit(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<ApprovalInstanceDto> {
    return this.approvals.submit(tenant, formId, recordId, permissions)
  }

  @Get("records/:recordId")
  @RequiresFormAction("view")
  async getForRecord(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<{ instance: ApprovalInstanceDto | null }> {
    return { instance: await this.approvals.getForRecord(tenant, formId, recordId) }
  }
}

/* 簽核決策 + 我的待簽(跨表單;不掛 PermissionGuard 之 formId 檢查 —— 簽核權由步驟角色 gate)。 */
@Controller("api/approvals")
@UseGuards(TenantGuard)
export class ApprovalInboxController {
  constructor(@Inject(ApprovalService) private readonly approvals: ApprovalService) {}

  @Get("pending")
  async listPending(@Tenant() tenant: TenantContext): Promise<ApprovalInstanceDto[]> {
    return this.approvals.listMyPending(tenant)
  }

  /* 🔴 稽核用:簽核紀錄鏈完整性報告。admin 限定(service 內強制)。
     回斷點清單而不是「通過/不通過」—— 稽核者要的是「哪一筆、斷在哪」。 */
  @Get("chain-report")
  async chainReport(@Tenant() tenant: TenantContext): Promise<{
    breaks: readonly unknown[]
    checkedAt: string
  }> {
    return this.approvals.chainReport(tenant, undefined)
  }

  @Post(":instanceId/decide")
  @HttpCode(200)
  async decide(
    @Tenant() tenant: TenantContext,
    @Param("instanceId", ParseIntPipe) instanceId: number,
    @Body(new ZodValidationPipe(decisionBodySchema))
    body: z.infer<typeof decisionBodySchema>,
  ): Promise<ApprovalInstanceDto> {
    return this.approvals.decide(tenant, instanceId, body.decision, body.comment, undefined)
  }

  /* 🔴 OQ-AP2-5|臨時加簽(同關加人)。授權與自簽後門的防護都在 service 內。 */
  @Post(":instanceId/add-approver")
  @HttpCode(200)
  async addApprover(
    @Tenant() tenant: TenantContext,
    @Param("instanceId", ParseIntPipe) instanceId: number,
    @Body(new ZodValidationPipe(addApproverBodySchema))
    body: z.infer<typeof addApproverBodySchema>,
  ): Promise<ApprovalInstanceDto> {
    return this.approvals.addApprover(tenant, instanceId, body.actorId)
  }

  @Post(":instanceId/withdraw")
  @HttpCode(200)
  async withdraw(
    @Tenant() tenant: TenantContext,
    @Param("instanceId", ParseIntPipe) instanceId: number,
  ): Promise<ApprovalInstanceDto> {
    return this.approvals.withdraw(tenant, instanceId)
  }
}
