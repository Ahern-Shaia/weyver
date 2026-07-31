"use client"

import { User } from "lucide-react"
import { type ReactNode, useState } from "react"
import { type Role, type RolePermissions, useRolePermissions } from "@/lib/engine/authz"
import { FieldMatrix } from "./field-matrix"
import { AccessPreview } from "./access-preview"
import { FormMatrix } from "./form-matrix"

/* 選定角色的詳情:header + 分頁(表單權限 / 欄位權限 / 成員)。admin 特判全權。 */
type Tab = "forms" | "fields" | "members"

export function RoleDetail({ role }: { readonly role: Role | null }): ReactNode {
  const [tab, setTab] = useState<Tab>("forms")
  const perms = useRolePermissions(role?.id ?? null)
  if (!role) return null

  const isAdmin = role.isSystem && role.key === "admin"

  return (
    <>
      <div className="shrink-0 border-b border-line bg-card px-5 pt-3">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[16px] font-semibold text-ink">{role.name}</h3>
          <span className="rounded-xs border border-line bg-label px-1.5 py-px text-[10px] font-medium text-ink-3">
            {role.isSystem ? "系統角色" : "自訂角色"}
          </span>
          {role.depth > 0 ? (
            <span className="rounded-xs border border-fx/30 bg-fx-bg px-1.5 py-px text-[10px] font-medium text-fx">
              繼承上層
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11.5px] text-ink-3">
          {isAdmin
            ? "管理員 = 全租戶所有動作(系統角色,不需逐表設定)"
            : `${perms.data?.memberActorIds.length ?? 0} 名成員 · 有效權限 = 本角色 ∪ 上層`}
        </p>
        <div className="mt-2.5 flex gap-0.5">
          {(
            [
              ["forms", "表單權限"],
              ["fields", "欄位權限"],
              ["members", "成員"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                tab === key
                  ? "border-b-2 border-primary px-3 pt-1.5 pb-2 text-[12.5px] font-semibold text-primary"
                  : "border-b-2 border-transparent px-3 pt-1.5 pb-2 text-[12.5px] font-medium text-ink-3 hover:text-ink"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {isAdmin ? (
          <div className="rounded-md border border-line bg-card px-4 py-3 text-[12px] text-ink-3">
            管理員角色擁有全部動作與欄位存取,無法也不需逐表設定。請以自訂角色做細粒度授權。
          </div>
        ) : perms.isPending ? (
          <div className="text-[12px] text-ink-3">載入權限…</div>
        ) : perms.data ? (
          <>
            {tab === "forms" ? (
              <>
                <FormMatrix roleId={role.id} perms={perms.data} />
                {/* 設完馬上能看見後果 —— Salesforce 外洩案例的根因正是缺這一步 */}
                <AccessPreview />
              </>
            ) : null}
            {tab === "fields" ? <FieldMatrix roleId={role.id} perms={perms.data} /> : null}
            {tab === "members" ? <Members perms={perms.data} /> : null}
          </>
        ) : null}
      </div>
    </>
  )
}

function Members({ perms }: { readonly perms: RolePermissions }): ReactNode {
  return (
    <div className="max-w-md">
      <p className="mb-3 text-[11.5px] text-ink-3">
        指派此角色的使用者。owner 於建立公司時自動為管理員。
      </p>
      {perms.memberActorIds.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-3 py-4 text-[12px] text-ink-3">
          尚無成員。使用者指派介面(含使用者清單)為後續交付。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {perms.memberActorIds.map((id) => (
            <div
              key={id}
              className="flex items-center gap-3 rounded-md border border-line bg-card px-3 py-2.5"
            >
              <span className="flex size-7 items-center justify-center rounded-full border border-line bg-label text-[11px] font-semibold text-ink-2">
                <User size={14} strokeWidth={1.9} />
              </span>
              <span className="font-mono text-[12px] text-ink-2">actor #{id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
