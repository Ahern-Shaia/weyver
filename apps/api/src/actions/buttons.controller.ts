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
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { type ButtonDto, createButtonBodySchema, updateButtonBodySchema } from "./action-specs.js"
import { type ActionResult, ButtonService } from "./button.service.js"

/* R1·後續-1 M1 按鈕 CRUD + 執行(薄 controller)。
   定義(建/改/刪)= design 權;執行 = edit 權(動作副作用另由 RecordService 權限兜底)。 */
@Controller("api/forms/:formId/buttons")
@UseGuards(TenantGuard, PermissionGuard)
export class ButtonsController {
  constructor(@Inject(ButtonService) private readonly buttons: ButtonService) {}

  @Get()
  @RequiresFormAction("view")
  async list(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<ButtonDto[]> {
    return this.buttons.list(tenant, formId)
  }

  @Post()
  @RequiresFormAction("design")
  async create(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(createButtonBodySchema))
    body: z.infer<typeof createButtonBodySchema>,
  ): Promise<ButtonDto> {
    return this.buttons.create(tenant, formId, body)
  }

  @Patch(":buttonId")
  @RequiresFormAction("design")
  async update(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("buttonId", ParseIntPipe) buttonId: number,
    @Body(new ZodValidationPipe(updateButtonBodySchema))
    body: z.infer<typeof updateButtonBodySchema>,
  ): Promise<ButtonDto> {
    return this.buttons.update(tenant, formId, buttonId, body)
  }

  @Delete(":buttonId")
  @RequiresFormAction("design")
  @HttpCode(204)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("buttonId", ParseIntPipe) buttonId: number,
  ): Promise<void> {
    await this.buttons.remove(tenant, formId, buttonId)
  }

  /* 執行:POST 但語意依動作;要求 edit(副作用寫入由 RecordService 權限再驗)*/
  @Post(":buttonId/run/:recordId")
  @RequiresFormAction("edit")
  @HttpCode(200)
  async run(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("buttonId", ParseIntPipe) buttonId: number,
    @Param("recordId", ParseIntPipe) recordId: number,
  ): Promise<ActionResult> {
    return this.buttons.execute(tenant, formId, recordId, buttonId, permissions)
  }
}
