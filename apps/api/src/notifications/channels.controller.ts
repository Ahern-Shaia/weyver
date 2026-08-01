import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { CHANNEL_IDS, type ChannelId, isChannelId } from "./channel-registry.js"
import { type ChannelStatus, ChannelConfigService } from "./channel-config.service.js"
import { ChannelSenderService, type SendResult } from "./channel-sender.service.js"

/* 🔴 R1·A-1 M4|通知通道連接 API。

   **全部限管理員** —— 通道憑證是公司級資產,且能改它的人等同能把公司的通知
   轉發到自己的 Slack。與租戶設定同一把尺(見 SettingsController)。

   回應**永不含憑證**(OQ-SC-7=A,Grafana `secureJsonFields` 語意):
   只回 `secretSet` 布林與指紋。 */

const saveSchema = z.object({
  /* 非機密設定;值一律轉字串,避免 jsonb 裡混入型別不一致的髒資料 */
  config: z.record(z.string(), z.string().max(500)).default({}),
  /* 🔴 **省略 = 保留原值**,不是清空 —— 使用者改 SMTP port 時不該被迫重打密碼。
     要清除必須顯式送 `clearSecret`。 */
  secret: z.string().min(1).max(2000).optional(),
  clearSecret: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

@Controller("api/notification-channels")
@UseGuards(TenantGuard, PermissionGuard)
export class ChannelsController {
  constructor(
    @Inject(ChannelConfigService) private readonly configs: ChannelConfigService,
    @Inject(ChannelSenderService) private readonly sender: ChannelSenderService,
  ) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
  ): Promise<ChannelStatus[]> {
    this.assertAdmin(permissions)
    return this.configs.list(tenant.tenantId)
  }

  @Put(":channel")
  async save(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("channel") channel: string,
    @Body(new ZodValidationPipe(saveSchema)) body: z.infer<typeof saveSchema>,
  ): Promise<ChannelStatus> {
    this.assertAdmin(permissions)
    return this.configs.save(tenant.tenantId, tenant.actorId, {
      channel: this.parseChannel(channel),
      config: body.config,
      ...(body.secret === undefined ? {} : { secret: body.secret }),
      ...(body.clearSecret === undefined ? {} : { clearSecret: body.clearSecret }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
    })
  }

  /* 測試發送。成功即記錄 `verifiedAt` —— 沒測過的通道不該被當成可用。 */
  @Post(":channel/test")
  async test(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("channel") channel: string,
  ): Promise<SendResult> {
    this.assertAdmin(permissions)
    return this.sender.sendTest(tenant.tenantId, this.parseChannel(channel))
  }

  private assertAdmin(permissions: EffectivePermissions): void {
    if (!permissions.isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "僅管理員可設定通知通道" })
    }
  }

  /* 路徑參數必須對照註冊表白名單 —— 未知值直接拒,不讓它流進 DB 的 channel 欄 */
  private parseChannel(value: string): ChannelId {
    if (!isChannelId(value)) {
      throw new ForbiddenException({
        code: "UNKNOWN_CHANNEL",
        message: `未知的通道;可用:${CHANNEL_IDS.join(" / ")}`,
      })
    }
    return value
  }
}
