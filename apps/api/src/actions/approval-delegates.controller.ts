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
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions, SelfService } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { ApprovalDelegateService, type DelegateDto } from "./approval-delegate.service.js"

/* #104 簽核代理人 API。

   路徑刻意不掛在 `api/approvals/` 底下 —— 那個 controller 的 `:instanceId`
   會把 `delegates` 吃成一個實例 id,是註冊順序決定成敗的那種脆弱。

   端點不設 formId,故 PermissionGuard 在此只負責解出 `isAdmin`(代設他人用)。 */

const createSchema = z.object({
  delegateActorId: z.number().int().positive(),
  /* 省略 = 設定自己的代理(自助路徑)。指定他人限 admin —— 見 service 註解 */
  principalActorId: z.number().int().positive().optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
})

@Controller("api/approval-delegates")
@UseGuards(TenantGuard, PermissionGuard)
export class ApprovalDelegatesController {
  constructor(
    @Inject(ApprovalDelegateService) private readonly delegates: ApprovalDelegateService,
  ) {}

  @Get()
  async listMine(
    @Tenant() tenant: TenantContext,
  ): Promise<{ actorId: number; granted: DelegateDto[]; received: DelegateDto[] }> {
    return this.delegates.listMine(tenant)
  }

  @Post()
  @SelfService()
  async create(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ): Promise<DelegateDto> {
    return this.delegates.create(tenant, permissions.isAdmin, body)
  }

  @Delete(":id")
  @SelfService()
  @HttpCode(204)
  async revoke(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    await this.delegates.revoke(tenant, permissions.isAdmin, id)
  }
}
