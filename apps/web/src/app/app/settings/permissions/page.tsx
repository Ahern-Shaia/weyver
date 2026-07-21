"use client"

import { Segmented } from "@weyver/ui/segmented"
import { Check, FolderTree, Plus, ShieldCheck, User } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import {
  ACTION_LABEL,
  FIELD_VISIBILITIES,
  type FieldVisibility,
  FORM_ACTIONS,
  type FormAction,
  type Role,
  type RolePermissions,
  useCreateRole,
  useRolePermissions,
  useRoles,
  useSetFieldVisibility,
  useSetFormActions,
  VISIBILITY_LABEL,
} from "@/lib/engine/authz"
import { describeEngineError } from "@/lib/engine/client"
import { useForm, useForms } from "@/lib/engine/hooks"

/* P0-4a 權限管理頁(S22 設定 · admin only)。角色/部門樹 + 表單×動作矩陣 + 欄位可見性。
   對應 permissions-admin-uplift mockup;接 M7 動作級 admin API。deny-by-default。 */
type Tab = "forms" | "fields" | "members"

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
          <div className="m-5 rounded-lg border border-er-line bg-er-t px-3 py-2.5 text-[12px] text-er">
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

function RoleTree({
  roles,
  loading,
  selectedId,
  onSelect,
}: {
  readonly roles: readonly Role[]
  readonly loading: boolean
  readonly selectedId: number | null
  readonly onSelect: (id: number) => void
}): ReactNode {
  const createRole = useCreateRole()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")

  const system = roles.filter((r) => r.isSystem)
  const custom = roles.filter((r) => !r.isSystem).sort((a, b) => a.depth - b.depth || a.id - b.id)

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    createRole.mutate(
      { key: `role_${Date.now().toString(36)}`, name: trimmed, parentId: null },
      {
        onSuccess: (role) => {
          onSelect(role.id)
          setName("")
          setAdding(false)
        },
      },
    )
  }

  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-line bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-2 px-3">
        <b className="text-[12.5px] font-semibold">角色 / 部門</b>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title="新增角色"
          className="ml-auto flex size-6 items-center justify-center rounded-sm border border-line text-ink-3 hover:bg-head hover:text-ink"
        >
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>
      {adding ? (
        <div className="border-b border-line-2 p-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
              if (e.key === "Escape") setAdding(false)
            }}
            placeholder="角色名稱,Enter 建立"
            className="w-full rounded-sm border border-line bg-surface px-2 py-1 text-[12px] outline-none focus:border-primary"
          />
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto p-1.5">
        {loading ? <div className="px-2 py-1.5 text-[11.5px] text-ink-4">載入…</div> : null}
        <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-wide text-ink-4">
          系統角色
        </div>
        {system.map((r) => (
          <RoleItem key={r.id} role={r} active={r.id === selectedId} onSelect={onSelect} />
        ))}
        <div className="px-2 pt-2.5 pb-1 text-[10px] font-semibold tracking-wide text-ink-4">
          部門 / 自訂角色
        </div>
        {custom.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-ink-4">尚無自訂角色</div>
        ) : (
          custom.map((r) => (
            <RoleItem key={r.id} role={r} active={r.id === selectedId} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  )
}

function RoleItem({
  role,
  active,
  onSelect,
}: {
  readonly role: Role
  readonly active: boolean
  readonly onSelect: (id: number) => void
}): ReactNode {
  const Icon = role.isSystem ? ShieldCheck : role.depth > 0 ? User : FolderTree
  return (
    <button
      type="button"
      onClick={() => onSelect(role.id)}
      style={{ paddingLeft: `${8 + role.depth * 14}px` }}
      className={
        active
          ? "flex w-full items-center gap-2 rounded-md border-l-2 border-primary bg-primary-t py-1.5 pr-2 text-left text-[12px] font-semibold text-primary"
          : "flex w-full items-center gap-2 rounded-md border-l-2 border-transparent py-1.5 pr-2 text-left text-[12px] text-ink-2 hover:bg-surface"
      }
    >
      <Icon size={13} strokeWidth={1.9} className={active ? "text-primary" : "text-ink-4"} />
      <span className="truncate">{role.name}</span>
      {role.key === "admin" ? (
        <span className="ml-auto rounded-xs border border-line px-1 font-mono text-[9px] text-ink-4">
          全權
        </span>
      ) : null}
    </button>
  )
}

function RoleDetail({ role }: { readonly role: Role | null }): ReactNode {
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
        <p className="mt-1 text-[11.5px] text-ink-4">
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
          <div className="rounded-lg border border-line bg-card px-4 py-3 text-[12px] text-ink-3">
            管理員角色擁有全部動作與欄位存取,無法也不需逐表設定。請以自訂角色做細粒度授權。
          </div>
        ) : perms.isPending ? (
          <div className="text-[12px] text-ink-3">載入權限…</div>
        ) : perms.data ? (
          <>
            {tab === "forms" ? <FormMatrix roleId={role.id} perms={perms.data} /> : null}
            {tab === "fields" ? <FieldMatrix roleId={role.id} perms={perms.data} /> : null}
            {tab === "members" ? <Members perms={perms.data} /> : null}
          </>
        ) : null}
      </div>
    </>
  )
}

function FormMatrix({
  roleId,
  perms,
}: {
  readonly roleId: number
  readonly perms: RolePermissions
}): ReactNode {
  const { data: forms } = useForms()
  const setActions = useSetFormActions(roleId)
  const byForm = useMemo(() => {
    const m = new Map<number, Set<FormAction>>()
    for (const f of perms.forms) m.set(f.formId, new Set(f.actions))
    return m
  }, [perms.forms])

  const roots = (forms ?? []).filter((f) => f.parentFormId === null)

  const toggle = (formId: number, action: FormAction): void => {
    const current = new Set(byForm.get(formId) ?? [])
    if (current.has(action)) current.delete(action)
    else {
      current.add(action)
      if (current.size > 0) current.add("view") // 檢視為基礎
    }
    setActions.mutate({ formId, actions: [...current] })
  }

  return (
    <>
      <p className="mb-3 border-l-2 border-primary py-0.5 pl-3 text-[11.5px] text-ink-3">
        <b className="text-ink-2">deny-by-default</b>
        :未勾=無此動作(全無 → 該角色看不到此表單)。勾任一動作自動含「檢視」。
      </p>
      <div className="overflow-hidden rounded-lg border border-line bg-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-head">
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-3">表單</th>
              {FORM_ACTIONS.map((a) => (
                <th
                  key={a}
                  className="w-[52px] px-1 py-2 text-center text-[11px] font-semibold text-ink-3"
                >
                  {ACTION_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roots.map((f) => {
              const set = byForm.get(f.id) ?? new Set<FormAction>()
              return (
                <tr key={f.id} className="border-t border-line-2 hover:bg-surface">
                  <td className="px-3 py-2 font-medium text-ink">{f.name}</td>
                  {FORM_ACTIONS.map((a) => (
                    <td key={a} className="px-1 py-2 text-center">
                      <CheckBox
                        on={set.has(a)}
                        amber={a === "design"}
                        disabled={setActions.isPending}
                        onClick={() => toggle(f.id, a)}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
            {roots.length === 0 ? (
              <tr>
                <td colSpan={FORM_ACTIONS.length + 1} className="px-3 py-4 text-[12px] text-ink-4">
                  尚無表單。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  )
}

function CheckBox({
  on,
  amber,
  disabled,
  onClick,
}: {
  readonly on: boolean
  readonly amber?: boolean
  readonly disabled?: boolean
  readonly onClick: () => void
}): ReactNode {
  const base =
    "inline-flex size-5 items-center justify-center rounded-[4px] border transition-colors disabled:opacity-50"
  const cls = on
    ? amber
      ? "border-wn bg-wn text-white"
      : "border-primary bg-primary text-white"
    : "border-line bg-card text-transparent hover:border-primary"
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`${base} ${cls}`}>
      <Check size={12} strokeWidth={2.6} />
    </button>
  )
}

function FieldMatrix({
  roleId,
  perms,
}: {
  readonly roleId: number
  readonly perms: RolePermissions
}): ReactNode {
  const { data: forms } = useForms()
  const roots = (forms ?? []).filter((f) => f.parentFormId === null)
  const [formId, setFormId] = useState<number | null>(null)
  const active = formId ?? roots[0]?.id ?? null
  const { data: form } = useForm(active)
  const setVis = useSetFieldVisibility(roleId)

  const byField = useMemo(() => {
    const m = new Map<number, FieldVisibility>()
    for (const f of perms.fields) m.set(f.fieldId, f.visibility)
    return m
  }, [perms.fields])

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11.5px] text-ink-3">選表單</span>
        <select
          value={active ?? ""}
          onChange={(e) => setFormId(Number(e.target.value))}
          className="rounded-md border border-line bg-card px-2 py-1 text-[12px] text-ink outline-none focus:border-primary"
        >
          {roots.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-3 border-l-2 border-primary py-0.5 pl-3 text-[11.5px] text-ink-3">
        欄位可見性收斂於表單動作。<b className="text-ink-2">隱藏</b>
        =後端不回該欄值(非前端隱藏)。缺列繼承表單。
      </p>
      <div className="overflow-hidden rounded-lg border border-line bg-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-head">
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-3">欄位</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-3">型別</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold text-ink-3">可見性</th>
            </tr>
          </thead>
          <tbody>
            {(form?.fields ?? []).map((fld) => (
              <tr key={fld.id} className="border-t border-line-2 hover:bg-surface">
                <td className="px-3 py-2 font-medium text-ink">{fld.name}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-4">{fld.type}</td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex">
                    <Segmented
                      ariaLabel={`${fld.name} 可見性`}
                      value={byField.get(fld.id) ?? "read"}
                      onValueChange={(v) =>
                        setVis.mutate({ fieldId: fld.id, visibility: v as FieldVisibility })
                      }
                      options={FIELD_VISIBILITIES.map((v) => ({
                        label: VISIBILITY_LABEL[v],
                        value: v,
                      }))}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {form && form.fields.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-[12px] text-ink-4">
                  此表單尚無欄位。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
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
        <div className="rounded-lg border border-dashed border-line px-3 py-4 text-[12px] text-ink-4">
          尚無成員。使用者指派介面(含使用者清單)為後續交付。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {perms.memberActorIds.map((id) => (
            <div
              key={id}
              className="flex items-center gap-3 rounded-lg border border-line bg-card px-3 py-2.5"
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
