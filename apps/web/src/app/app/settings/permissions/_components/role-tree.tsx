"use client"

import { type Role, useCreateRole } from "@/lib/engine/authz"
import { Input } from "@weyver/ui/input"
import { Plus, ShieldCheck, User, Users } from "lucide-react"
import { type ReactNode, useState } from "react"

/* 角色 / 部門清單(系統角色 + 自訂 + 建立)。權限管理頁左欄。

   🔴 **刻意是平的**(authz 0-bis 項 1)。Salesforce 官方建議角色階層「越平越好、
   3–4 層幾乎永遠夠」,而 **Airtable / Baserow / NocoDB / Ragic 根本沒有角色樹** ——
   它們用的是資源層級的繼承(我方對應物 = 分類授權 → 表單繼承)。
   客戶是行政兼職,理解成本才是瓶頸。

   後端**有**完整的樹(`createRole` 收 `parentId`、`PATCH .../parent` 可改掛載點、
   有深度上限),schema 成本已付、留著;但**預設 UI 不開那個入口**。
   ⚠️ 因此本元件不得再用資料夾類圖示或無說明的縮排去暗示「這裡可以做出階層」——
   那是承諾了做不到的事,而那正是本專案這一輪反覆在修的形態。 */
export function RoleTree({
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
        <b className="text-[13px] font-semibold">角色 / 部門</b>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title="新增角色"
          className="ml-auto flex size-6 items-center justify-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
        >
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>
      {adding ? (
        <div className="border-b border-line-2 p-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
              if (e.key === "Escape") setAdding(false)
            }}
            placeholder="角色名稱,Enter 建立"
          />
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto p-1.5">
        {loading ? <div className="px-2 py-1.5 text-[12px] text-ink-3">載入…</div> : null}
        <div className="px-2 pt-1.5 pb-1 text-[12px] font-semibold tracking-wide text-ink-3">
          系統角色
        </div>
        {system.map((r) => (
          <RoleItem key={r.id} role={r} active={r.id === selectedId} onSelect={onSelect} />
        ))}
        <div className="px-2 pt-2.5 pb-1 text-[12px] font-semibold tracking-wide text-ink-3">
          部門 / 自訂角色
        </div>
        {custom.length === 0 ? (
          <div className="px-2 py-1 text-[12px] text-ink-3">尚無自訂角色</div>
        ) : (
          custom.map((r) => (
            <RoleItem key={r.id} role={r} active={r.id === selectedId} onSelect={onSelect} />
          ))
        )}
        {/* 只有真的存在階層時才解釋縮排 —— 平常不佔版面,也不去教一個這裡開不了的功能 */}
        {custom.some((r) => r.depth > 0) ? (
          <p className="px-2 pt-2 text-[12px] text-ink-3">
            縮排代表既有的角色階層。此處不調整階層,權限請用分類授權與表單繼承設定。
          </p>
        ) : null}
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
  /* 系統角色 = 盾;其餘一律「一群人」。**不用資料夾圖示** ——
     資料夾暗示「裡面裝得下別的角色」,而這個畫面做不到那件事。 */
  const Icon = role.isSystem ? ShieldCheck : role.depth > 0 ? User : Users
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
      <Icon size={13} strokeWidth={1.9} className={active ? "text-primary" : "text-ink-3"} />
      <span className="truncate">{role.name}</span>
      {role.key === "admin" ? (
        <span className="ml-auto rounded-xs border border-line px-1 font-mono text-[12px] text-ink-3">
          全權
        </span>
      ) : null}
    </button>
  )
}
