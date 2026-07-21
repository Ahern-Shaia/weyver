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
  fields: z.array(z.object({ fieldId: z.number(), visibility: z.enum(FIELD_VISIBILITIES) })),
  memberActorIds: z.array(z.number()),
})
export type RolePermissions = z.infer<typeof rolePermsSchema>

const voidSchema = z.undefined().or(z.unknown().transform(() => undefined))

export const authzKeys = {
  roles: ["authz", "roles"] as const,
  perms: (roleId: number) => ["authz", "roles", roleId, "perms"] as const,
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
