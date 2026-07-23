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
  Put,
  UseGuards,
} from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import { Tenant } from "../http/tenant.decorator.js"
import type { TenantContext } from "../http/tenant-context.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { AdminGuard } from "./admin.guard.js"
import { AuthzAdminService, type ResourcesView } from "./authz-admin.service.js"
import { FORM_ACTIONS } from "./authz-model.js"
import type { CategoryRow } from "./authz.repository.js"

const categoryNameSchema = z.object({ name: z.string().min(1).max(100) })
const categoryPatchSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((v) => v.name !== undefined || v.position !== undefined, "name / position 至少一項")
const defaultActionsSchema = z.object({ actions: z.array(z.enum(FORM_ACTIONS)) })
const formCategorySchema = z.object({ categoryId: z.number().int().positive().nullable() })
const formSensitiveSchema = z.object({ isSensitive: z.boolean() })

/* P0-4a·uplift 資源軸繼承管理 API(admin only)。分類 CRUD / 租戶預設 profile / 表單旗標 / 矩陣資料源。 */
@Controller("api/authz")
@UseGuards(TenantGuard, AdminGuard)
export class AuthzResourceController {
  constructor(@Inject(AuthzAdminService) private readonly admin: AuthzAdminService) {}

  @Get("resources")
  getResources(@Tenant() tenant: TenantContext): Promise<ResourcesView> {
    return this.admin.getResources(tenant.tenantId)
  }

  @Get("categories")
  listCategories(@Tenant() tenant: TenantContext): Promise<CategoryRow[]> {
    return this.admin.listCategories(tenant.tenantId)
  }

  @Post("categories")
  createCategory(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(categoryNameSchema)) body: z.infer<typeof categoryNameSchema>,
  ): Promise<CategoryRow> {
    return this.admin.createCategory(tenant.tenantId, body.name)
  }

  @Patch("categories/:categoryId")
  @HttpCode(204)
  async updateCategory(
    @Tenant() tenant: TenantContext,
    @Param("categoryId", ParseIntPipe) categoryId: number,
    @Body(new ZodValidationPipe(categoryPatchSchema)) body: z.infer<typeof categoryPatchSchema>,
  ): Promise<void> {
    // exactOptionalPropertyTypes:略去 undefined 鍵,不直接傳 zod optional 形狀
    const patch: { name?: string; position?: number } = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.position !== undefined) patch.position = body.position
    await this.admin.updateCategory(tenant.tenantId, categoryId, patch)
  }

  @Delete("categories/:categoryId")
  @HttpCode(204)
  async deleteCategory(
    @Tenant() tenant: TenantContext,
    @Param("categoryId", ParseIntPipe) categoryId: number,
  ): Promise<void> {
    await this.admin.deleteCategory(tenant.tenantId, categoryId)
  }

  @Get("settings/default-form-actions")
  async getDefaultActions(@Tenant() tenant: TenantContext): Promise<{ actions: string[] }> {
    return { actions: await this.admin.getDefaultActions(tenant.tenantId) }
  }

  @Put("settings/default-form-actions")
  @HttpCode(204)
  async setDefaultActions(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(defaultActionsSchema)) body: z.infer<typeof defaultActionsSchema>,
  ): Promise<void> {
    await this.admin.setDefaultActions(tenant.tenantId, body.actions)
  }

  @Put("forms/:formId/category")
  @HttpCode(204)
  async setFormCategory(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(formCategorySchema)) body: z.infer<typeof formCategorySchema>,
  ): Promise<void> {
    await this.admin.setFormCategory(tenant.tenantId, formId, body.categoryId)
  }

  @Put("forms/:formId/sensitive")
  @HttpCode(204)
  async setFormSensitive(
    @Tenant() tenant: TenantContext,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(formSensitiveSchema)) body: z.infer<typeof formSensitiveSchema>,
  ): Promise<void> {
    await this.admin.setFormSensitive(tenant.tenantId, formId, body.isSensitive)
  }
}
