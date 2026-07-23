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
import { AuthzAdminService, type RolePermissionsView } from "./authz-admin.service.js"
import { FIELD_VISIBILITIES, FORM_ACTIONS } from "./authz-model.js"
import type { RoleRow } from "./authz.repository.js"

const roleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, "key 須小寫字母開頭,限 a-z0-9_")
const createRoleSchema = z.object({
  key: roleKeySchema,
  name: z.string().min(1).max(100),
  parentId: z.number().int().positive().nullable().default(null),
})
const reparentSchema = z.object({ parentId: z.number().int().positive().nullable() })
const memberSchema = z.object({ actorId: z.number().int().positive() })
const formActionsSchema = z.object({ actions: z.array(z.enum(FORM_ACTIONS)) })
const fieldVisibilitySchema = z.object({ visibility: z.enum(FIELD_VISIBILITIES) })

/* P0-4a M5|權限管理後台 API(admin only)。薄 controller → AuthzAdminService。
   AdminGuard 掛 TenantGuard 之後,全端點需租戶 admin(dev isSuperAdmin 放行)。 */
@Controller("api/authz/roles")
@UseGuards(TenantGuard, AdminGuard)
export class AuthzAdminController {
  constructor(@Inject(AuthzAdminService) private readonly admin: AuthzAdminService) {}

  @Get()
  listRoles(@Tenant() tenant: TenantContext): Promise<RoleRow[]> {
    return this.admin.listRoles(tenant.tenantId)
  }

  @Post()
  createRole(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createRoleSchema)) body: z.infer<typeof createRoleSchema>,
  ): Promise<RoleRow> {
    return this.admin.createRole(tenant.tenantId, body)
  }

  @Patch(":roleId/parent")
  @HttpCode(204)
  async reparent(
    @Tenant() tenant: TenantContext,
    @Param("roleId", ParseIntPipe) roleId: number,
    @Body(new ZodValidationPipe(reparentSchema)) body: z.infer<typeof reparentSchema>,
  ): Promise<void> {
    await this.admin.setRoleParent(tenant.tenantId, roleId, body.parentId)
  }

  @Delete(":roleId")
  @HttpCode(204)
  async deleteRole(
    @Tenant() tenant: TenantContext,
    @Param("roleId", ParseIntPipe) roleId: number,
  ): Promise<void> {
    await this.admin.deleteRole(tenant.tenantId, roleId)
  }

  @Get(":roleId/permissions")
  getPermissions(
    @Tenant() tenant: TenantContext,
    @Param("roleId", ParseIntPipe) roleId: number,
  ): Promise<RolePermissionsView> {
    return this.admin.getRolePermissions(tenant.tenantId, roleId)
  }

  @Post(":roleId/members")
  @HttpCode(204)
  async addMember(
    @Tenant() tenant: TenantContext,
    @Param("roleId", ParseIntPipe) roleId: number,
    @Body(new ZodValidationPipe(memberSchema)) body: z.infer<typeof memberSchema>,
  ): Promise<void> {
    await this.admin.assignMember(tenant.tenantId, roleId, body.actorId)
  }

  @Delete(":roleId/members/:actorId")
  @HttpCode(204)
  async removeMember(
    @Tenant() tenant: TenantContext,
    @Param("roleId", ParseIntPipe) roleId: number,
    @Param("actorId", ParseIntPipe) actorId: number,
  ): Promise<void> {
    await this.admin.removeMember(tenant.tenantId, roleId, actorId)
  }

  @Put(":roleId/forms/:formId")
  @HttpCode(204)
  async setFormActions(
    @Tenant() tenant: TenantContext,
    @Param("roleId", ParseIntPipe) roleId: number,
    @Param("formId", ParseIntPipe) formId: number,
    @Body(new ZodValidationPipe(formActionsSchema)) body: z.infer<typeof formActionsSchema>,
  ): Promise<void> {
    await this.admin.setFormActions(tenant.tenantId, roleId, formId, body.actions)
  }

  @Put(":roleId/fields/:fieldId")
  @HttpCode(204)
  async setFieldPermission(
    @Tenant() tenant: TenantContext,
    @Param("roleId", ParseIntPipe) roleId: number,
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body(new ZodValidationPipe(fieldVisibilitySchema)) body: z.infer<typeof fieldVisibilitySchema>,
  ): Promise<void> {
    await this.admin.setFieldPermission(tenant.tenantId, roleId, fieldId, body.visibility)
  }

  /* P0-4a·uplift:角色 × 分類 動作集(繼承層)。 */
  @Put(":roleId/categories/:categoryId")
  @HttpCode(204)
  async setCategoryActions(
    @Tenant() tenant: TenantContext,
    @Param("roleId", ParseIntPipe) roleId: number,
    @Param("categoryId", ParseIntPipe) categoryId: number,
    @Body(new ZodValidationPipe(formActionsSchema)) body: z.infer<typeof formActionsSchema>,
  ): Promise<void> {
    await this.admin.setCategoryActions(tenant.tenantId, roleId, categoryId, body.actions)
  }
}
