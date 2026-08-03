import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common"
import type { FieldVisibility, FormAction } from "./authz-model.js"
import { RoleCycleError, RoleTreeDepthError } from "./authz-tree.js"
import {
  AuthzRepository,
  type CategoryRow,
  RoleParentError,
  type RoleRow,
} from "./authz.repository.js"

/* repo/tree 拋的角色錯 → HTTP。unique(tenant,key) 衝突(pg 23505)→ 409。 */
function translateRoleError(error: unknown): never {
  if (error instanceof RoleCycleError) {
    throw new BadRequestException({ code: "ROLE_CYCLE", message: "不可將角色掛到其後代之下" })
  }
  if (error instanceof RoleTreeDepthError) {
    throw new BadRequestException({ code: "ROLE_TREE_TOO_DEEP", message: "角色樹過深" })
  }
  if (error instanceof RoleParentError) {
    throw new BadRequestException({ code: "ROLE_PARENT_NOT_FOUND", message: "上層角色不存在" })
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    throw new ConflictException({ code: "ROLE_KEY_EXISTS", message: "角色代號已存在" })
  }
  throw error
}

export interface RolePermissionsView {
  readonly forms: ReadonlyArray<{
    formId: number
    actions: readonly FormAction[]
    /* E-1 記錄範圍(#96) */
    scopedActions: readonly FormAction[]
  }>
  readonly categories: ReadonlyArray<{ categoryId: number; actions: readonly FormAction[] }>
  readonly fields: ReadonlyArray<{ fieldId: number; visibility: FieldVisibility }>
  readonly memberActorIds: readonly number[]
}

/* 權限矩陣「分類分組」UI 資料源:分類 + 表單(含所屬分類/敏感)。 */
export interface ResourcesView {
  readonly categories: readonly CategoryRow[]
  readonly forms: ReadonlyArray<{
    id: number
    name: string
    categoryId: number | null
    isSensitive: boolean
  }>
}

/* P0-4a M5|權限管理後台服務(admin only,由 AdminGuard 守)。薄 service:驗證 + 編排 repo。
   所有操作綁 tenantId;跨租戶角色一律當作不存在(404),不洩他租戶結構。 */
@Injectable()
export class AuthzAdminService {
  constructor(@Inject(AuthzRepository) private readonly repo: AuthzRepository) {}

  listRoles(tenantId: number): Promise<RoleRow[]> {
    return this.repo.listRoles(tenantId)
  }

  async createRole(
    tenantId: number,
    input: { key: string; name: string; parentId: number | null },
  ): Promise<RoleRow> {
    try {
      return await this.repo.createRole({ tenantId, ...input })
    } catch (error) {
      return translateRoleError(error)
    }
  }

  async setRoleParent(tenantId: number, roleId: number, parentId: number | null): Promise<void> {
    await this.mustRole(tenantId, roleId)
    if (parentId !== null) await this.mustRole(tenantId, parentId)
    try {
      await this.repo.setRoleParent(tenantId, roleId, parentId)
    } catch (error) {
      translateRoleError(error)
    }
  }

  async deleteRole(tenantId: number, roleId: number): Promise<void> {
    const role = await this.mustRole(tenantId, roleId)
    if (role.isSystem) {
      throw new BadRequestException({ code: "SYSTEM_ROLE_IMMUTABLE", message: "系統角色不可刪除" })
    }
    if ((await this.repo.countChildren(tenantId, roleId)) > 0) {
      throw new ConflictException({ code: "ROLE_HAS_CHILDREN", message: "有子角色,不可刪除" })
    }
    await this.repo.deleteRole(tenantId, roleId)
  }

  async assignMember(tenantId: number, roleId: number, actorId: number): Promise<void> {
    await this.mustRole(tenantId, roleId)
    await this.repo.assignMember(tenantId, roleId, actorId)
  }

  async removeMember(tenantId: number, roleId: number, actorId: number): Promise<void> {
    await this.mustRole(tenantId, roleId)
    await this.repo.removeMember(roleId, actorId)
  }

  async setFormActions(
    tenantId: number,
    roleId: number,
    formId: number,
    actions: readonly FormAction[],
    scopedActions: readonly FormAction[] = [],
  ): Promise<void> {
    await this.mustRole(tenantId, roleId)
    await this.repo.setFormActions(roleId, formId, actions, scopedActions)
  }

  async setFieldPermission(
    tenantId: number,
    roleId: number,
    fieldId: number,
    visibility: FieldVisibility,
  ): Promise<void> {
    await this.mustRole(tenantId, roleId)
    await this.repo.setFieldPermission(roleId, fieldId, visibility)
  }

  async getRolePermissions(tenantId: number, roleId: number): Promise<RolePermissionsView> {
    await this.mustRole(tenantId, roleId)
    const [forms, categories, fields, memberActorIds] = await Promise.all([
      this.repo.loadFormPermissions([roleId]),
      this.repo.loadCategoryPermissions([roleId]),
      this.repo.loadFieldPermissions([roleId]),
      this.repo.listRoleMembers(tenantId, roleId),
    ])
    return {
      forms: forms.map((f) => ({
        formId: f.formId,
        actions: f.actions,
        scopedActions: f.scopedActions,
      })),
      categories: categories.map((c) => ({ categoryId: c.categoryId, actions: c.actions })),
      fields: fields.map((f) => ({ fieldId: f.fieldId, visibility: f.visibility })),
      memberActorIds,
    }
  }

  // --- P0-4a·uplift 資源軸繼承(分類 / 分類授權 / 預設 profile / 表單旗標)---

  listCategories(tenantId: number): Promise<CategoryRow[]> {
    return this.repo.listCategories(tenantId)
  }

  async createCategory(tenantId: number, name: string): Promise<CategoryRow> {
    try {
      return await this.repo.createCategory(tenantId, name)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ code: "CATEGORY_NAME_EXISTS", message: "分類名稱已存在" })
      }
      throw error
    }
  }

  async updateCategory(
    tenantId: number,
    categoryId: number,
    patch: { name?: string; position?: number },
  ): Promise<void> {
    await this.mustCategory(tenantId, categoryId)
    try {
      await this.repo.updateCategory(tenantId, categoryId, patch)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ code: "CATEGORY_NAME_EXISTS", message: "分類名稱已存在" })
      }
      throw error
    }
  }

  async deleteCategory(tenantId: number, categoryId: number): Promise<void> {
    await this.mustCategory(tenantId, categoryId)
    await this.repo.deleteCategory(tenantId, categoryId)
  }

  async setCategoryActions(
    tenantId: number,
    roleId: number,
    categoryId: number,
    actions: readonly FormAction[],
  ): Promise<void> {
    await this.mustRole(tenantId, roleId)
    await this.mustCategory(tenantId, categoryId)
    await this.repo.setCategoryActions(roleId, categoryId, actions)
  }

  getDefaultActions(tenantId: number): Promise<FormAction[]> {
    return this.repo.getTenantDefaultActions(tenantId)
  }

  setDefaultActions(tenantId: number, actions: readonly FormAction[]): Promise<void> {
    return this.repo.setTenantDefaultActions(tenantId, actions)
  }

  async setFormSensitive(tenantId: number, formId: number, isSensitive: boolean): Promise<void> {
    const ok = await this.repo.setFormSensitive(tenantId, formId, isSensitive)
    if (!ok) throw new NotFoundException({ code: "FORM_NOT_FOUND", message: `form ${formId}` })
  }

  async setFormCategory(
    tenantId: number,
    formId: number,
    categoryId: number | null,
  ): Promise<void> {
    if (categoryId !== null) await this.mustCategory(tenantId, categoryId)
    const ok = await this.repo.setFormCategory(tenantId, formId, categoryId)
    if (!ok) throw new NotFoundException({ code: "FORM_NOT_FOUND", message: `form ${formId}` })
  }

  async getResources(tenantId: number): Promise<ResourcesView> {
    const [categories, forms] = await Promise.all([
      this.repo.listCategories(tenantId),
      this.repo.listFormResources(tenantId),
    ])
    return { categories, forms }
  }

  private async mustRole(tenantId: number, roleId: number): Promise<RoleRow> {
    const role = await this.repo.getRole(tenantId, roleId)
    if (role === null) {
      throw new NotFoundException({ code: "ROLE_NOT_FOUND", message: `role ${roleId} not found` })
    }
    return role
  }

  private async mustCategory(tenantId: number, categoryId: number): Promise<CategoryRow> {
    const category = await this.repo.getCategory(tenantId, categoryId)
    if (category === null) {
      throw new NotFoundException({ code: "CATEGORY_NOT_FOUND", message: `category ${categoryId}` })
    }
    return category
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
}
