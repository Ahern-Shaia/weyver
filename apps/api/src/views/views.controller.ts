import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common"
import type { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import { RequiresFormAction } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { type ViewDto, createViewBodySchema, updateViewBodySchema } from "./view-specs.js"
import { ViewService } from "./view.service.js"

/* R1·UP-2 視圖 CRUD(薄 controller)。@RequiresFormAction("view"):只需表單 view 權即可管理其視圖;
   共通 / 預設 / 鎖定之 admin gating 在 ViewService。跨租戶由 TenantGuard + view.repository tenant scope。 */
@Controller("api/forms/:formId/views")
@UseGuards(TenantGuard, PermissionGuard)
export class ViewsController {
  constructor(@Inject(ViewService) private readonly views: ViewService) {}

  @Get()
  @RequiresFormAction("view")
  async list(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<ViewDto[]> {
    return this.views.list(tenant, formId)
  }

  @Post()
  @RequiresFormAction("view")
  async create(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(createViewBodySchema))
    body: z.infer<typeof createViewBodySchema>,
  ): Promise<ViewDto> {
    return this.views.create(tenant, formId, body)
  }

  @Patch(":viewId")
  @RequiresFormAction("view")
  async update(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("viewId", ParseIntPipe) viewId: number,
    @Body(new ZodValidationPipe(updateViewBodySchema))
    body: z.infer<typeof updateViewBodySchema>,
  ): Promise<ViewDto> {
    return this.views.update(tenant, formId, viewId, body)
  }

  @Delete(":viewId")
  @RequiresFormAction("view")
  @HttpCode(204)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("viewId", ParseIntPipe) viewId: number,
  ): Promise<void> {
    await this.views.remove(tenant, formId, viewId)
  }
}
