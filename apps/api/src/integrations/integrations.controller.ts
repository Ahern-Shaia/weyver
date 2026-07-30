import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { ApiKeyService } from "./api-key.service.js"
import { EVENT_TYPES } from "./event.service.js"
import { WebhookService } from "./webhook.service.js"

/* G-1|整合設定 API。**一律限 admin** —— webhook 端點能把租戶資料送到外部,
   是租戶級的安全設定,不是表單級功能。 */

const createEndpointSchema = z.object({
  url: z.string().min(1).max(2048),
  description: z.string().max(200).optional(),
  eventTypes: z.array(z.enum([...Object.values(EVENT_TYPES), "ping"])).default([]),
})

const verifySchema = z.object({ token: z.string().min(1).max(200) })

const issueKeySchema = z.object({
  name: z.string().min(1).max(80),
  /* 以誰的身分執行。**不另給一套權限** —— 金鑰的權限恆等於這個人的權限,
     否則它就成了繞過 authz 的側門。 */
  subjectActorId: z.number().int().positive(),
  scopes: z.array(z.enum(["read", "write"])).default(["read"]),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
})

@Controller("api/integrations")
@UseGuards(TenantGuard, PermissionGuard)
export class IntegrationsController {
  constructor(
    @Inject(WebhookService) private readonly webhooks: WebhookService,
    @Inject(ApiKeyService) private readonly apiKeys: ApiKeyService,
  ) {}

  private assertAdmin(permissions: EffectivePermissions): void {
    if (!permissions.isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "整合設定需要管理員權限" })
    }
  }

  @Get("webhooks")
  async list(@Tenant() tenant: TenantContext, @Permissions() permissions: EffectivePermissions) {
    this.assertAdmin(permissions)
    return { endpoints: await this.webhooks.list(tenant.tenantId) }
  }

  /* 建端點會觸發一次 DNS 解析 → 限流以免被當成內網掃描器 */
  @Post("webhooks")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(createEndpointSchema)) body: z.infer<typeof createEndpointSchema>,
  ) {
    this.assertAdmin(permissions)
    /* secret 與 verifyToken **只在這一次回傳**;之後只能輪替不能再讀 */
    return this.webhooks.create(tenant.tenantId, tenant.actorId, body)
  }

  @Post("webhooks/:id/verify")
  async verify(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>,
  ) {
    this.assertAdmin(permissions)
    return { verified: await this.webhooks.verify(tenant.tenantId, id, body.token) }
  }

  @Post("webhooks/:id/rotate-secret")
  async rotate(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ) {
    this.assertAdmin(permissions)
    return this.webhooks.rotateSecret(tenant.tenantId, id)
  }

  @Post("webhooks/:id/enable")
  @HttpCode(204)
  async enable(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.webhooks.setEnabled(tenant.tenantId, id, true)
  }

  @Post("webhooks/:id/disable")
  @HttpCode(204)
  async disable(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.webhooks.setEnabled(tenant.tenantId, id, false)
  }

  @Post("webhooks/:id/test")
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async test(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.webhooks.sendTest(tenant.tenantId, id)
  }

  @Get("webhooks/:id/deliveries")
  async deliveries(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ) {
    this.assertAdmin(permissions)
    return { deliveries: await this.webhooks.deliveries(tenant.tenantId, id) }
  }

  @Post("deliveries/:id/redeliver")
  @HttpCode(204)
  async redeliver(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.webhooks.redeliver(tenant.tenantId, id)
  }

  @Get("api-keys")
  async listKeys(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
  ) {
    this.assertAdmin(permissions)
    return { keys: await this.apiKeys.list(tenant.tenantId) }
  }

  @Post("api-keys")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async issueKey(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(issueKeySchema)) body: z.infer<typeof issueKeySchema>,
  ) {
    this.assertAdmin(permissions)
    /* 明文只在這一次回傳 */
    return this.apiKeys.issue(tenant.tenantId, {
      name: body.name,
      subjectActorId: body.subjectActorId,
      scopes: body.scopes,
      expiresAt:
        body.expiresInDays === undefined
          ? undefined
          : new Date(Date.now() + body.expiresInDays * 86_400_000),
      createdBy: tenant.actorId,
    })
  }

  @Delete("api-keys/:id")
  @HttpCode(204)
  async revokeKey(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.apiKeys.revoke(tenant.tenantId, id)
  }

  @Delete("webhooks/:id")
  @HttpCode(204)
  async remove(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<void> {
    this.assertAdmin(permissions)
    await this.webhooks.remove(tenant.tenantId, id)
  }
}
