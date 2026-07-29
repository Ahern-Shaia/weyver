import { Inject, Injectable } from "@nestjs/common"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../db/db.module.js"
import {
  categoryPermissions,
  fieldPermissions,
  formCategories,
  formDefs,
  formPermissions,
  roleMembers,
  roles,
  tenants,
} from "../db/schema.js"
import { type FieldVisibility, type FormAction, isFormAction } from "./authz-model.js"
import { depthForParent, RoleCycleError, wouldCreateCycle } from "./authz-tree.js"

/* P0-4a authz Tier-1 資料存取(特權 DRIZZLE 車道,如 IdentityService)。
   授權表非 RLS;每查詢以 tenant_id 綁定 + app 層 scope。docs/modules/R1/authz.md §4/§7。 */

export interface RoleRow {
  readonly id: number
  readonly tenantId: number
  readonly parentId: number | null
  readonly key: string
  readonly name: string
  readonly isSystem: boolean
  readonly depth: number
}

export interface FormPermissionRow {
  readonly roleId: number
  readonly formId: number
  readonly actions: readonly FormAction[]
  /* E-1 記錄範圍:列在此者只看得到 / 只能動「自己的」記錄 */
  readonly scopedActions: readonly FormAction[]
}

export interface FieldPermissionRow {
  readonly roleId: number
  readonly fieldId: number
  readonly visibility: FieldVisibility
}

/* P0-4a·uplift 資源軸繼承 */
export interface CategoryRow {
  readonly id: number
  readonly tenantId: number
  readonly parentId: number | null
  readonly name: string
  readonly position: number
}

export interface CategoryPermissionRow {
  readonly roleId: number
  readonly categoryId: number
  readonly actions: readonly FormAction[]
}

/* 表單授權 metadata(繼承解析輸入):所屬分類 / 敏感 / 建立者(owner) */
export interface FormMetaRow {
  readonly formId: number
  readonly categoryId: number | null
  readonly isSensitive: boolean
  readonly createdBy: number | null
}

/* 系統角色(每租戶建立時種入)。'admin' 具全租戶 manage 語意(於 PermissionService 特判,OQ-5);
   editor/viewer 為便利起點,實際權限由 admin 於矩陣指派(deny-by-default,未指派=none)。 */
const SYSTEM_ROLES: ReadonlyArray<{ key: string; name: string }> = [
  { key: "admin", name: "管理員" },
  { key: "editor", name: "編輯者" },
  { key: "viewer", name: "檢視者" },
]

export const ADMIN_ROLE_KEY = "admin"

@Injectable()
export class AuthzRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    /* form_def 為 RLS 表 → 該讀取走 app 車道(F-6 M3);authz Tier-1 表刻意非 RLS,續用特權車道 */
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  /* 租戶建立 → 種入系統角色(idempotent;並發下 unique(tenant_id,key) 兜底)。 */
  async seedSystemRoles(tenantId: number): Promise<void> {
    await this.db
      .insert(roles)
      .values(
        SYSTEM_ROLES.map((r) => ({
          tenantId,
          key: r.key,
          name: r.name,
          isSystem: true,
          depth: 0,
        })),
      )
      .onConflictDoNothing({ target: [roles.tenantId, roles.key] })
  }

  async listRoles(tenantId: number): Promise<RoleRow[]> {
    const rows = await this.db.select().from(roles).where(eq(roles.tenantId, tenantId))
    return rows.map(toRoleRow)
  }

  async getRole(tenantId: number, roleId: number): Promise<RoleRow | null> {
    const rows = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)))
      .limit(1)
    const row = rows[0]
    return row ? toRoleRow(row) : null
  }

  /* 建角色。新角色無既存子節點 → 不可能成環;只驗 parent 同租戶 + 深度上限。 */
  async createRole(input: {
    readonly tenantId: number
    readonly key: string
    readonly name: string
    readonly parentId: number | null
  }): Promise<RoleRow> {
    let depth = 0
    if (input.parentId !== null) {
      const parent = await this.getRole(input.tenantId, input.parentId)
      if (!parent) throw new RoleParentError(input.parentId)
      depth = depthForParent(parent.depth)
    }
    const inserted = await this.db
      .insert(roles)
      .values({
        tenantId: input.tenantId,
        key: input.key,
        name: input.name,
        parentId: input.parentId,
        isSystem: false,
        depth,
      })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error("createRole: insert returned no row")
    return toRoleRow(row)
  }

  /* 改 parent(reparent)。防環:新 parent 的祖先鏈不得含本角色;重算深度。 */
  async setRoleParent(tenantId: number, roleId: number, newParentId: number | null): Promise<void> {
    const parentOfMap = await this.loadParentMap(tenantId)
    if (wouldCreateCycle(roleId, newParentId, (id) => parentOfMap.get(id) ?? null)) {
      throw new RoleCycleError(roleId)
    }
    const parentDepth =
      newParentId === null ? null : ((await this.getRole(tenantId, newParentId))?.depth ?? null)
    if (newParentId !== null && parentDepth === null) throw new RoleParentError(newParentId)
    await this.db
      .update(roles)
      .set({ parentId: newParentId, depth: depthForParent(parentDepth) })
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)))
  }

  async assignMember(tenantId: number, roleId: number, actorId: number): Promise<void> {
    await this.db
      .insert(roleMembers)
      .values({ tenantId, roleId, actorId })
      .onConflictDoNothing({ target: [roleMembers.roleId, roleMembers.actorId] })
  }

  /* 指派 actor 進系統角色(key)。owner→admin 對映(OQ-5)用;idempotent。 */
  async assignActorToSystemRole(tenantId: number, key: string, actorId: number): Promise<void> {
    const rows = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.isSystem, true), eq(roles.key, key)))
      .limit(1)
    const role = rows[0]
    if (!role) throw new Error(`system role ${key} not seeded for tenant ${tenantId}`)
    await this.assignMember(tenantId, role.id, actorId)
  }

  async removeMember(roleId: number, actorId: number): Promise<void> {
    await this.db
      .delete(roleMembers)
      .where(and(eq(roleMembers.roleId, roleId), eq(roleMembers.actorId, actorId)))
  }

  /* 刪角色(僅該租戶)。系統角色 / 有子節點(FK RESTRICT)之防護在 service 層先驗。 */
  async deleteRole(tenantId: number, roleId: number): Promise<void> {
    await this.db.delete(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)))
  }

  async listRoleMembers(tenantId: number, roleId: number): Promise<number[]> {
    const rows = await this.db
      .select({ actorId: roleMembers.actorId })
      .from(roleMembers)
      .where(and(eq(roleMembers.tenantId, tenantId), eq(roleMembers.roleId, roleId)))
    return rows.map((r) => r.actorId)
  }

  async countChildren(tenantId: number, roleId: number): Promise<number> {
    const rows = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.parentId, roleId)))
    return rows.length
  }

  /* 設角色對某表單的動作集。空集 = 撤銷授予 → 刪列(等同 deny-by-default)。 */
  async setFormActions(
    roleId: number,
    formId: number,
    actions: readonly FormAction[],
  ): Promise<void> {
    if (actions.length === 0) {
      await this.db
        .delete(formPermissions)
        .where(and(eq(formPermissions.roleId, roleId), eq(formPermissions.formId, formId)))
      return
    }
    const unique = [...new Set(actions)]
    await this.db
      .insert(formPermissions)
      .values({ roleId, formId, actions: unique })
      .onConflictDoUpdate({
        target: [formPermissions.roleId, formPermissions.formId],
        set: { actions: unique },
      })
  }

  async setFieldPermission(
    roleId: number,
    fieldId: number,
    visibility: FieldVisibility,
  ): Promise<void> {
    await this.db
      .insert(fieldPermissions)
      .values({ roleId, fieldId, visibility })
      .onConflictDoUpdate({
        target: [fieldPermissions.roleId, fieldPermissions.fieldId],
        set: { visibility },
      })
  }

  // --- P0-4a·uplift 資源軸繼承(分類 / 分類授權 / 表單 metadata / 租戶預設 profile)---

  /* 建分類(append 到末尾:position = 現有最大 + 1)。unique(tenant,name) 由 DB 兜底。 */
  async createCategory(tenantId: number, name: string): Promise<CategoryRow> {
    const existing = await this.db
      .select({ position: formCategories.position })
      .from(formCategories)
      .where(eq(formCategories.tenantId, tenantId))
    const nextPos = existing.reduce((max, r) => Math.max(max, r.position + 1), 0)
    const inserted = await this.db
      .insert(formCategories)
      .values({ tenantId, name, position: nextPos })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error("createCategory: insert returned no row")
    return toCategoryRow(row)
  }

  async listCategories(tenantId: number): Promise<CategoryRow[]> {
    const rows = await this.db
      .select()
      .from(formCategories)
      .where(eq(formCategories.tenantId, tenantId))
      .orderBy(asc(formCategories.position), asc(formCategories.id))
    return rows.map(toCategoryRow)
  }

  async getCategory(tenantId: number, categoryId: number): Promise<CategoryRow | null> {
    const rows = await this.db
      .select()
      .from(formCategories)
      .where(and(eq(formCategories.tenantId, tenantId), eq(formCategories.id, categoryId)))
      .limit(1)
    const row = rows[0]
    return row ? toCategoryRow(row) : null
  }

  async updateCategory(
    tenantId: number,
    categoryId: number,
    patch: { readonly name?: string; readonly position?: number },
  ): Promise<void> {
    const set: { name?: string; position?: number } = {}
    if (patch.name !== undefined) set.name = patch.name
    if (patch.position !== undefined) set.position = patch.position
    if (Object.keys(set).length === 0) return
    await this.db
      .update(formCategories)
      .set(set)
      .where(and(eq(formCategories.tenantId, tenantId), eq(formCategories.id, categoryId)))
  }

  /* 刪分類。form_def.category_id ON DELETE SET NULL(表回退未分類);category_permissions CASCADE。 */
  async deleteCategory(tenantId: number, categoryId: number): Promise<void> {
    await this.db
      .delete(formCategories)
      .where(and(eq(formCategories.tenantId, tenantId), eq(formCategories.id, categoryId)))
  }

  /* 設角色對某分類的動作集(繼承層)。空集 = 撤銷 → 刪列(deny-by-default)。 */
  async setCategoryActions(
    roleId: number,
    categoryId: number,
    actions: readonly FormAction[],
  ): Promise<void> {
    if (actions.length === 0) {
      await this.db
        .delete(categoryPermissions)
        .where(
          and(
            eq(categoryPermissions.roleId, roleId),
            eq(categoryPermissions.categoryId, categoryId),
          ),
        )
      return
    }
    const unique = [...new Set(actions)]
    await this.db
      .insert(categoryPermissions)
      .values({ roleId, categoryId, actions: unique })
      .onConflictDoUpdate({
        target: [categoryPermissions.roleId, categoryPermissions.categoryId],
        set: { actions: unique },
      })
  }

  async loadCategoryPermissions(roleIds: readonly number[]): Promise<CategoryPermissionRow[]> {
    if (roleIds.length === 0) return []
    const rows = await this.db
      .select()
      .from(categoryPermissions)
      .where(inArray(categoryPermissions.roleId, [...roleIds]))
    return rows.map((r) => ({
      roleId: r.roleId,
      categoryId: r.categoryId,
      actions: r.actions.filter(isFormAction),
    }))
  }

  /* 全租戶表單授權 metadata(繼承解析輸入)。form_def 小且每租戶,單次索引查詢 + per-request 快取。 */
  async loadFormMeta(tenantId: number): Promise<FormMetaRow[]> {
    const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
      tx
        .select({
          formId: formDefs.id,
          categoryId: formDefs.categoryId,
          isSensitive: formDefs.isSensitive,
          createdBy: formDefs.createdBy,
        })
        .from(formDefs)
        .where(and(eq(formDefs.tenantId, tenantId), isNull(formDefs.deletedAt))),
    )
    return rows
  }

  async getTenantDefaultActions(tenantId: number): Promise<FormAction[]> {
    const rows = await this.db
      .select({ actions: tenants.defaultFormActions })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    return (rows[0]?.actions ?? []).filter(isFormAction)
  }

  async setTenantDefaultActions(tenantId: number, actions: readonly FormAction[]): Promise<void> {
    await this.db
      .update(tenants)
      .set({ defaultFormActions: [...new Set(actions)] })
      .where(eq(tenants.id, tenantId))
  }

  /* 敏感旗標為 admin-only 動作(OQ-ARI-5)。form_def 為共享 Tier-1;authz 車道直接寫該欄
     (authz 模組不可依賴 form-engine MetadataService → 會成 DI 循環)。回傳是否有列命中(tenant-scope)。 */
  async setFormSensitive(tenantId: number, formId: number, isSensitive: boolean): Promise<boolean> {
    const updated = await this.db
      .update(formDefs)
      .set({ isSensitive })
      .where(
        and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId), isNull(formDefs.deletedAt)),
      )
      .returning({ id: formDefs.id })
    return updated.length > 0
  }

  /* 表單歸類(NULL=未分類)。分類同租戶驗證於 service 層。回傳是否命中(tenant-scope)。 */
  async setFormCategory(
    tenantId: number,
    formId: number,
    categoryId: number | null,
  ): Promise<boolean> {
    const updated = await this.db
      .update(formDefs)
      .set({ categoryId })
      .where(
        and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId), isNull(formDefs.deletedAt)),
      )
      .returning({ id: formDefs.id })
    return updated.length > 0
  }

  /* 表單清單 + 授權 metadata(分類/敏感);權限矩陣「分類分組」UI 之資料源。 */
  async listFormResources(
    tenantId: number,
  ): Promise<Array<{ id: number; name: string; categoryId: number | null; isSensitive: boolean }>> {
    return this.db
      .select({
        id: formDefs.id,
        name: formDefs.name,
        categoryId: formDefs.categoryId,
        isSensitive: formDefs.isSensitive,
      })
      .from(formDefs)
      .where(and(eq(formDefs.tenantId, tenantId), isNull(formDefs.deletedAt)))
      .orderBy(asc(formDefs.id))
  }

  /* actor 的角色閉包(直接角色 + 所有祖先),單一 recursive CTE。
     UNION(非 UNION ALL)去重 + 遇環自然終止(visited);tenant scope 綁在 anchor。 */
  async resolveActorRoleIds(tenantId: number, actorId: number): Promise<number[]> {
    const res = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE actor_roles AS (
        SELECT r.id, r.parent_id
        FROM ${roleMembers} rm
        JOIN ${roles} r ON r.id = rm.role_id
        WHERE rm.tenant_id = ${tenantId} AND rm.actor_id = ${actorId}
        UNION
        SELECT p.id, p.parent_id
        FROM ${roles} p
        JOIN actor_roles ar ON p.id = ar.parent_id
      )
      SELECT id FROM actor_roles
    `)
    return res.rows.map((r) => Number(r.id))
  }

  async loadFormPermissions(roleIds: readonly number[]): Promise<FormPermissionRow[]> {
    if (roleIds.length === 0) return []
    const rows = await this.db
      .select()
      .from(formPermissions)
      .where(inArray(formPermissions.roleId, [...roleIds]))
    return rows.map((r) => ({
      roleId: r.roleId,
      formId: r.formId,
      actions: r.actions.filter(isFormAction),
      scopedActions: r.scopedActions.filter(isFormAction),
    }))
  }

  async loadFieldPermissions(roleIds: readonly number[]): Promise<FieldPermissionRow[]> {
    if (roleIds.length === 0) return []
    const rows = await this.db
      .select()
      .from(fieldPermissions)
      .where(inArray(fieldPermissions.roleId, [...roleIds]))
    return rows.map((r) => ({
      roleId: r.roleId,
      fieldId: r.fieldId,
      visibility: r.visibility as FieldVisibility,
    }))
  }

  async isAdminActor(tenantId: number, actorId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: roles.id })
      .from(roleMembers)
      .innerJoin(roles, eq(roles.id, roleMembers.roleId))
      .where(
        and(
          eq(roleMembers.tenantId, tenantId),
          eq(roleMembers.actorId, actorId),
          eq(roles.isSystem, true),
          eq(roles.key, ADMIN_ROLE_KEY),
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  private async loadParentMap(tenantId: number): Promise<Map<number, number | null>> {
    const rows = await this.db
      .select({ id: roles.id, parentId: roles.parentId })
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
    return new Map(rows.map((r) => [r.id, r.parentId]))
  }
}

export class RoleParentError extends Error {
  constructor(readonly parentId: number) {
    super(`parent role ${parentId} not found in tenant`)
    this.name = "RoleParentError"
  }
}

function toRoleRow(row: typeof roles.$inferSelect): RoleRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    parentId: row.parentId,
    key: row.key,
    name: row.name,
    isSystem: row.isSystem,
    depth: row.depth,
  }
}

function toCategoryRow(row: typeof formCategories.$inferSelect): CategoryRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    parentId: row.parentId,
    name: row.name,
    position: row.position,
  }
}
