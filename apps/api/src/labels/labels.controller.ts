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
import { type LabelDto, createLabelBodySchema, updateLabelBodySchema } from "./label-specs.js"
import { LabelsService } from "./labels.service.js"

/* R1·後續-2 標籤定義 CRUD(薄 controller)。定義 = design 權;列出/列印預覽 = view 權。 */
@Controller("api/forms/:formId/labels")
@UseGuards(TenantGuard, PermissionGuard)
export class LabelsController {
  constructor(@Inject(LabelsService) private readonly labels: LabelsService) {}

  @Get()
  @RequiresFormAction("view")
  async list(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<LabelDto[]> {
    return this.labels.list(tenant, formId)
  }

  @Post()
  @RequiresFormAction("design")
  async create(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(createLabelBodySchema))
    body: z.infer<typeof createLabelBodySchema>,
  ): Promise<LabelDto> {
    return this.labels.create(tenant, formId, body)
  }

  @Patch(":labelId")
  @RequiresFormAction("design")
  async update(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("labelId", ParseIntPipe) labelId: number,
    @Body(new ZodValidationPipe(updateLabelBodySchema))
    body: z.infer<typeof updateLabelBodySchema>,
  ): Promise<LabelDto> {
    return this.labels.update(tenant, formId, labelId, body)
  }

  @Delete(":labelId")
  @RequiresFormAction("design")
  @HttpCode(204)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("labelId", ParseIntPipe) labelId: number,
  ): Promise<void> {
    await this.labels.remove(tenant, formId, labelId)
  }
}
