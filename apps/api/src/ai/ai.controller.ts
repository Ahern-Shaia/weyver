import { Body, Controller, ForbiddenException, Get, Inject, Patch, UseGuards } from "@nestjs/common"
import type { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { AiConfigService } from "./ai-config.service.js"
import { type AiConfigDto, aiConfigPatchSchema, type AiUsageRow } from "./ai-specs.js"

/* 🔴 R1·AI-1 M1|AI 設定。

   權限沿用租戶設定的同一條分界(`settings.controller` §31-32 逐字):
   **讀不限 admin**(有沒有開 AI 是全體都需要知道的前提 —— 否則使用者
   看到停用的 AI 入口會不知道要找誰),**寫限 admin**。

   🔴 **金鑰只進不出**:`AiConfigDto` 沒有 `apiKey` 欄位,只有 `apiKeyHint`(末四碼)。
   這不是靠呼叫端自律 —— service 的 `get()` 根本不回明文,解密只在
   `resolveForCall()`,而那一支不經 controller。 */
@Controller("api/ai")
@UseGuards(TenantGuard, PermissionGuard)
export class AiController {
  constructor(@Inject(AiConfigService) private readonly ai: AiConfigService) {}

  @Get("config")
  async config(@Tenant() tenant: TenantContext): Promise<AiConfigDto> {
    return this.ai.get(tenant.tenantId)
  }

  @Patch("config")
  async patchConfig(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(aiConfigPatchSchema)) body: z.infer<typeof aiConfigPatchSchema>,
  ): Promise<AiConfigDto> {
    if (!permissions.isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "僅管理員可修改 AI 設定" })
    }
    return this.ai.update(tenant.tenantId, tenant.actorId, body)
  }

  /* ⚠️ 這是「**本平台代你送出了多少**」,不是「你還剩多少額度」——
     BYO key 模式下我方看不到客戶在 provider 那邊的帳單(migration 0064)。 */
  @Get("usage")
  async usage(@Tenant() tenant: TenantContext): Promise<AiUsageRow[]> {
    return this.ai.usageSince(tenant.tenantId)
  }
}
