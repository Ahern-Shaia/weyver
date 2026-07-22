"use client"

import { type ReactNode, useState } from "react"
import { useRoles } from "@/lib/engine/authz"
import { describeEngineError } from "@/lib/engine/client"
import { RoleDetail } from "./_components/role-detail"
import { RoleTree } from "./_components/role-tree"

/* P0-4a 權限管理頁(S22 設定 · admin only)。角色/部門樹 + 表單×動作矩陣 + 欄位可見性。
   對應 permissions-admin-uplift mockup;接 M7 動作級 admin API。deny-by-default。
   orchestrator 薄殼:左 RoleTree + 右 RoleDetail(細節元件見 _components/)。 */
export default function PermissionsPage(): ReactNode {
  const { data: roles, isPending, isError, error } = useRoles()
  const [roleId, setRoleId] = useState<number | null>(null)

  const selected = roles?.find((r) => r.id === roleId) ?? null
  const effectiveRoleId = selected?.id ?? roles?.find((r) => r.key === "admin")?.id ?? null

  return (
    <div className="flex h-full min-h-0">
      <RoleTree
        roles={roles ?? []}
        loading={isPending}
        selectedId={effectiveRoleId}
        onSelect={setRoleId}
      />
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {isError ? (
          <div className="m-5 rounded-md border border-er-line bg-er-t px-3 py-2.5 text-[12px] text-er">
            無法載入角色:{describeEngineError(error)}
          </div>
        ) : effectiveRoleId !== null ? (
          <RoleDetail
            key={effectiveRoleId}
            role={roles?.find((r) => r.id === effectiveRoleId) ?? null}
          />
        ) : (
          <div className="p-6 text-[12px] text-ink-3">載入中…</div>
        )}
      </div>
    </div>
  )
}
