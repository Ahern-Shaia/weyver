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
  Query,
  UseGuards,
} from "@nestjs/common"
import type { z } from "zod"
import { TenantGuard } from "../../auth/tenant.guard.js"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../../authz/authz-http.js"
import { AuthzRepository } from "../../authz/authz.repository.js"
import { PermissionGuard } from "../../authz/permission.guard.js"
import type { TenantContext } from "../../http/tenant-context.js"
import { Tenant } from "../../http/tenant.decorator.js"
import { ZodValidationPipe } from "../../http/zod-validation.pipe.js"
import { type WidgetDto, createWidgetBodySchema } from "./widget-specs.js"
import { WidgetService } from "./widget.service.js"

/* F-2 M4 小圖表。薄 controller → WidgetService。
   `@RequiresFormAction` 由 PermissionGuard 依方法推導(GET=view / POST=edit),
   故來源表單的權限在進到 service 之前就擋過了。 */
@Controller("api/forms/:formId/widgets")
@UseGuards(TenantGuard, PermissionGuard)
export class WidgetsController {
  constructor(
    @Inject(WidgetService) private readonly widgets: WidgetService,
    @Inject(AuthzRepository) private readonly authz: AuthzRepository,
  ) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Query("placement") placement?: string,
  ): Promise<WidgetDto[]> {
    const roleIds = await this.authz.resolveActorRoleIds(tenant.tenantId, tenant.actorId)
    return this.widgets.list(
      tenant.tenantId,
      formId,
      placement === "form" ? "form" : "list",
      permissions,
      roleIds,
    )
  }

  /* 可檢視群組的候選 —— **先被來源表單權限過濾**(OQ-PC-12 = A)。
     設計期就選不到沒權限的角色,故此清單本身即為執法的一半。 */
  @Get("role-candidates")
  @RequiresFormAction("design")
  roleCandidates(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<{ id: number; name: string }[]> {
    return this.widgets.visibleRoleCandidates(tenant.tenantId, formId)
  }

  @Post()
  @RequiresFormAction("design")
  @HttpCode(201)
  create(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(createWidgetBodySchema))
    body: z.infer<typeof createWidgetBodySchema>,
  ): Promise<{ id: number }> {
    return this.widgets.create(tenant.tenantId, formId, body, tenant.actorId)
  }

  @Delete(":widgetId")
  @RequiresFormAction("design")
  @HttpCode(204)
  remove(
    @Tenant() tenant: TenantContext,
    @Param("widgetId", ParseIntPipe) widgetId: number,
  ): Promise<void> {
    return this.widgets.remove(tenant.tenantId, widgetId)
  }
}
