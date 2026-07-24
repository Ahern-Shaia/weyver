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
import { TenantGuard } from "../../auth/tenant.guard.js"
import type { EffectivePermissions } from "../../authz/authz-effective.js"
import { Permissions, RequiresFormAction } from "../../authz/authz-http.js"
import { PermissionGuard } from "../../authz/permission.guard.js"
import type { TenantContext } from "../../http/tenant-context.js"
import { Tenant } from "../../http/tenant.decorator.js"
import { ZodValidationPipe } from "../../http/zod-validation.pipe.js"
import { DdlService } from "../ddl/ddl.service.js"
import { LayoutService } from "../layout/layout.service.js"
import { type Layout, layoutSchema } from "../layout/layout-specs.js"
import { MetadataService } from "../metadata/metadata.service.js"
import {
  addFieldSpecSchema,
  createFormSpecSchema,
  type AddFieldSpec,
  type CreateFormSpec,
} from "../specs/form-specs.js"
import {
  alterFieldTypeBodySchema,
  moveFieldBodySchema,
  toFieldDto,
  toFormDto,
  type FieldDto,
  type FormDto,
} from "./api-schemas.js"
import type { z } from "zod"

/* 薄 controller(AGENTS 分層鐵則):只做 HTTP 形狀 ↔ service 呼叫,零業務邏輯 */
@Controller("api/forms")
@UseGuards(TenantGuard, PermissionGuard)
export class FormsController {
  constructor(
    @Inject(DdlService) private readonly ddl: DdlService,
    @Inject(MetadataService) private readonly metadata: MetadataService,
    @Inject(LayoutService) private readonly layout: LayoutService,
  ) {}

  @Post()
  @RequiresFormAction("design") // 建表 = 設計動作;無 formId → 需租戶管理權(admin)
  async createForm(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createFormSpecSchema)) spec: CreateFormSpec,
  ): Promise<FormDto> {
    return toFormDto(await this.ddl.createForm(tenant.tenantId, spec, tenant.actorId))
  }

  @Get()
  async listForms(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
  ): Promise<
    Array<
      Omit<FormDto, "fields"> & {
        locked: boolean
        categoryId: number | null
        updatedAt: string
      }
    >
  > {
    const forms = await this.metadata.listForms(tenant.tenantId)
    // OQ-ARI-8:可讀 → 完整;非敏感無權 → 鎖定 stub(顯示,不含資料);敏感無權 → 隱藏(不回)
    const { readable, locked } = permissions.listableForms(forms.map((f) => f.id))
    const readableSet = new Set(readable)
    const lockedSet = new Set(locked)
    return forms
      .filter((form) => readableSet.has(form.id) || lockedSet.has(form.id))
      .map((form) => ({
        id: form.id,
        name: form.name,
        provisionState: form.provisionState,
        version: form.version,
        parentFormId: form.parentFormId,
        // R1·UP-1:工作區目錄用(所屬分類 + 最近更新)
        categoryId: form.categoryId,
        updatedAt: form.updatedAt.toISOString(),
        locked: lockedSet.has(form.id),
      }))
  }

  @Get(":formId")
  async getForm(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<FormDto> {
    return toFormDto(await this.metadata.getForm(tenant.tenantId, formId))
  }

  /* R1·UP-3 2D 設計器版面。GET=view;PUT=design(整表覆寫,純 metadata) */
  @Get(":formId/layout")
  async getLayout(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<{ layout: unknown }> {
    return { layout: await this.layout.getLayout(tenant.tenantId, formId) }
  }

  @Patch(":formId/layout")
  @RequiresFormAction("design")
  async putLayout(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(layoutSchema)) layout: Layout,
  ): Promise<Layout> {
    return this.layout.setLayout(tenant.tenantId, formId, layout)
  }

  @Delete(":formId")
  @HttpCode(204)
  @RequiresFormAction("design")
  async dropForm(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
  ): Promise<void> {
    await this.ddl.dropForm(tenant.tenantId, formId)
  }

  @Post(":formId/fields")
  @RequiresFormAction("design")
  async addField(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(addFieldSpecSchema)) spec: AddFieldSpec,
  ): Promise<FieldDto> {
    return toFieldDto(await this.ddl.addField(tenant.tenantId, formId, spec))
  }

  @Patch(":formId/fields/:fieldId/type")
  @HttpCode(204)
  @RequiresFormAction("design")
  async alterFieldType(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(alterFieldTypeBodySchema))
    body: z.infer<typeof alterFieldTypeBodySchema>,
  ): Promise<void> {
    await this.ddl.alterFieldType(tenant.tenantId, formId, fieldId, body.type, body.options)
  }

  @Patch(":formId/fields/:fieldId/position")
  @HttpCode(204)
  @RequiresFormAction("design")
  async moveField(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(moveFieldBodySchema))
    body: z.infer<typeof moveFieldBodySchema>,
  ): Promise<void> {
    await this.ddl.moveField(tenant.tenantId, formId, fieldId, body.direction)
  }

  @Delete(":formId/fields/:fieldId")
  @HttpCode(204)
  @RequiresFormAction("design")
  async dropField(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
  ): Promise<void> {
    await this.ddl.dropField(tenant.tenantId, formId, fieldId)
  }
}
