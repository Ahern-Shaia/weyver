"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  forms: z.array(z.object({ formId: z.number(), actions: z.array(z.enum(FORM_ACTIONS)) })),
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

export function useSetFormActions(roleId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { formId: number; actions: readonly FormAction[] }) =>
      engineFetch(`/authz/roles/${roleId}/forms/${input.formId}`, voidSchema, {
        method: "PUT",
        body: { actions: input.actions },
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
