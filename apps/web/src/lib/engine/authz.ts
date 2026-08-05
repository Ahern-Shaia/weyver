"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { z } from "zod"
import { engineFetch } from "./client"

/* P0-4a 權限管理 client(接 /api/authz/* → 後端 AuthzAdminController)。動作級(M7)。 */

export const FORM_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
  "design",
] as const
export type FormAction = (typeof FORM_ACTIONS)[number]

export const ACTION_LABEL: Record<FormAction, string> = {
  view: "檢視",
  create: "新增",
  edit: "編輯",
  delete: "刪除",
  approve: "核准",
  export: "匯出",
  design: "設計",
}

export const FIELD_VISIBILITIES = ["hidden", "read", "write"] as const
export type FieldVisibility = (typeof FIELD_VISIBILITIES)[number]

export const VISIBILITY_LABEL: Record<FieldVisibility, string> = {
  hidden: "隱藏",
  read: "唯讀",
  write: "可寫",
}

const roleSchema = z.object({
  id: z.number(),
  parentId: z.number().nullable(),
  key: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  depth: z.number(),
})
export type Role = z.infer<typeof roleSchema>

const rolePermsSchema = z.object({
  forms: z.array(
    z.object({
      formId: z.number(),
      actions: z.array(z.enum(FORM_ACTIONS)),
      /* E-1 記錄範圍(#96)。後端未回時視為空 = 全部 all */
      scopedActions: z.array(z.enum(FORM_ACTIONS)).default([]),
    }),
  ),
  categories: z.array(z.object({ categoryId: z.number(), actions: z.array(z.enum(FORM_ACTIONS)) })),
  fields: z.array(z.object({ fieldId: z.number(), visibility: z.enum(FIELD_VISIBILITIES) })),
  memberActorIds: z.array(z.number()),
})
export type RolePermissions = z.infer<typeof rolePermsSchema>

/* P0-4a·uplift 資源軸繼承:分類 + 表單授權 metadata(矩陣「分類分組」資料源) */
const categorySchema = z.object({
  id: z.number(),
  tenantId: z.number(),
  parentId: z.number().nullable(),
  name: z.string(),
  position: z.number(),
})
export type Category = z.infer<typeof categorySchema>

const formResourceSchema = z.object({
  id: z.number(),
  name: z.string(),
  categoryId: z.number().nullable(),
  isSensitive: z.boolean(),
})
export type FormResource = z.infer<typeof formResourceSchema>

const resourcesSchema = z.object({
  categories: z.array(categorySchema),
  forms: z.array(formResourceSchema),
})
export type Resources = z.infer<typeof resourcesSchema>

const defaultActionsSchema = z.object({ actions: z.array(z.enum(FORM_ACTIONS)) })

/* 🔴 `/api/authz/me`|前端**唯一**的能力來源。
   在此之前 `canDesign` 是寫死 `true` —— 後端有執法,但畫面說謊:
   使用者看得到他按不動的入口。 */
const myCapabilitiesSchema = z.object({
  isAdmin: z.boolean(),
  forms: z.record(z.string(), z.array(z.enum(FORM_ACTIONS))),
  /* v1.4|條件式格式的 `$actor` 虛擬欄位要用。**只給畫面** ——
     伺服器強制的那一半在後端自己解析 actor,不吃這裡送的東西。 */
  actorId: z.number(),
  groupIds: z.array(z.number()),
})
export type MyCapabilities = z.infer<typeof myCapabilitiesSchema>

export function useMyCapabilities() {
  return useQuery({
    queryKey: ["authz", "me"] as const,
    queryFn: () => engineFetch("/authz/me", myCapabilitiesSchema),
    staleTime: 60_000,
  })
}

/* admin 的 `forms` 刻意為空(見後端註解)—— 故必須先看 `isAdmin`,
   否則管理員會被判成什麼都不能做。載入中一律回 `false`:
   **寧可少顯示一個入口,也不要顯示一個按下去 403 的入口**。 */
export function canOnForm(
  caps: MyCapabilities | undefined,
  formId: number,
  action: FormAction,
): boolean {
  if (caps === undefined) return false
  if (caps.isAdmin) return true
  return caps.forms[String(formId)]?.includes(action) === true
}

const voidSchema = z.undefined().or(z.unknown().transform(() => undefined))

export const authzKeys = {
  roles: ["authz", "roles"] as const,
  perms: (roleId: number) => ["authz", "roles", roleId, "perms"] as const,
  resources: ["authz", "resources"] as const,
  defaultActions: ["authz", "default-form-actions"] as const,
}

export function useRoles() {
  return useQuery({
    queryKey: authzKeys.roles,
    queryFn: () => engineFetch("/authz/roles", z.array(roleSchema)),
  })
}

export function useRolePermissions(roleId: number | null) {
  return useQuery({
    queryKey: authzKeys.perms(roleId ?? -1),
    queryFn: () => engineFetch(`/authz/roles/${roleId}/permissions`, rolePermsSchema),
    enabled: roleId !== null,
  })
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { key: string; name: string; parentId: number | null }): Promise<Role> =>
      engineFetch("/authz/roles", roleSchema, { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.roles }),
  })
}

/* 🔴 E-1 存取預覽(#96)。回「看得到幾筆 / 全部幾筆 + 每筆為什麼」。
   唯讀試算,不做 impersonation —— 管理員得到判斷所需的一切,但不能藉此翻閱他人資料。 */
export const tenantActorSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
})
export type TenantActor = z.infer<typeof tenantActorSchema>

export const accessPreviewSchema = z.object({
  actorId: z.number(),
  formId: z.number(),
  scoped: z.boolean(),
  visibleCount: z.number(),
  totalCount: z.number(),
  samples: z.array(
    z.object({
      recordId: z.number(),
      title: z.string(),
      reason: z.enum(["owner", "assigned", "unrestricted"]),
    }),
  ),
})
export type AccessPreview = z.infer<typeof accessPreviewSchema>

/* 可預覽的人員 —— 不限某角色成員:有效存取是「這個人透過他所有角色能看到什麼」 */
export function usePreviewActors(enabled = true) {
  return useQuery({
    queryKey: ["authz", "preview", "actors"],
    queryFn: () => engineFetch("/forms/access-preview/actors", z.array(tenantActorSchema)),
    enabled,
  })
}

/* member 欄的 id → 姓名。記錄列表若直接印 actor id,使用者看到的是「58」——
   指派給誰是這個欄的全部意義,顯示成流水號等於沒做。只在表單真有 member 欄時才查。 */
export function useMemberNames(
  fields: readonly { readonly type: string }[],
): ReadonlyMap<number, string> {
  const has = fields.some((f) => f.type === "member")
  const { data } = usePreviewActors(has)
  return useMemo(() => new Map((data ?? []).map((a) => [a.id, a.name])), [data])
}

export function useAccessPreview(formId: number | null, actorId: number | null) {
  return useQuery({
    queryKey: ["authz", "preview", formId ?? -1, actorId ?? -1],
    queryFn: () => engineFetch(`/forms/${formId}/access-preview/${actorId}`, accessPreviewSchema),
    enabled: formId !== null && actorId !== null,
  })
}

export function useSetFormActions(roleId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      formId: number
      actions: readonly FormAction[]
      /* E-1 記錄範圍(#96):列在此者只及於「自己的」記錄 */
      scopedActions?: readonly FormAction[]
    }) =>
      engineFetch(`/authz/roles/${roleId}/forms/${input.formId}`, voidSchema, {
        method: "PUT",
        body: { actions: input.actions, scopedActions: input.scopedActions ?? [] },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.perms(roleId) }),
  })
}

export function useSetFieldVisibility(roleId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { fieldId: number; visibility: FieldVisibility }) =>
      engineFetch(`/authz/roles/${roleId}/fields/${input.fieldId}`, voidSchema, {
        method: "PUT",
        body: { visibility: input.visibility },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.perms(roleId) }),
  })
}

// --- P0-4a·uplift 資源軸繼承 ---

export function useResources() {
  return useQuery({
    queryKey: authzKeys.resources,
    queryFn: () => engineFetch("/authz/resources", resourcesSchema),
  })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string): Promise<Category> =>
      engineFetch("/authz/categories", categorySchema, { method: "POST", body: { name } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.resources }),
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { categoryId: number; name?: string; position?: number }) =>
      engineFetch(`/authz/categories/${input.categoryId}`, voidSchema, {
        method: "PATCH",
        body: { name: input.name, position: input.position },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.resources }),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (categoryId: number) =>
      engineFetch(`/authz/categories/${categoryId}`, voidSchema, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries(),
  })
}

/* 分類授權(繼承層)—— 影響所有角色的有效矩陣 → 廣義失效 */
export function useSetCategoryActions(roleId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { categoryId: number; actions: readonly FormAction[] }) =>
      engineFetch(`/authz/roles/${roleId}/categories/${input.categoryId}`, voidSchema, {
        method: "PUT",
        body: { actions: input.actions },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.perms(roleId) }),
  })
}

export function useSetFormCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { formId: number; categoryId: number | null }) =>
      engineFetch(`/authz/forms/${input.formId}/category`, voidSchema, {
        method: "PUT",
        body: { categoryId: input.categoryId },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.resources }),
  })
}

export function useSetFormSensitive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { formId: number; isSensitive: boolean }) =>
      engineFetch(`/authz/forms/${input.formId}/sensitive`, voidSchema, {
        method: "PUT",
        body: { isSensitive: input.isSensitive },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.resources }),
  })
}

export function useDefaultActions() {
  return useQuery({
    queryKey: authzKeys.defaultActions,
    queryFn: () => engineFetch("/authz/settings/default-form-actions", defaultActionsSchema),
  })
}

export function useSetDefaultActions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (actions: readonly FormAction[]) =>
      engineFetch("/authz/settings/default-form-actions", voidSchema, {
        method: "PUT",
        body: { actions },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: authzKeys.defaultActions }),
  })
}

/* 🔴 條件式格式的求值語境(`@weyver/rules` 之 `EvalContext`)。

   前端與後端**用同一個求值器**,所以語境的形狀也要一致 ——
   差別只在來源:這裡是 `/authz/me`,後端是 session。 */
export function useRuleContext(): { actorId: number | null; actorGroupIds: readonly number[] } {
  const { data } = useMyCapabilities()
  return useMemo(
    () => ({ actorId: data?.actorId ?? null, actorGroupIds: data?.groupIds ?? [] }),
    [data],
  )
}
