"use client"

import { THEMES, type ThemeId, applyTheme } from "@weyver/ui/theme-switcher"
import { Check, LayoutGrid, LogOut, Palette, ShieldCheck, Table2 } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type ReactNode, useEffect, useState } from "react"
import {
  authClient,
  organization,
  signOut,
  useActiveOrganization,
  useSession,
} from "@/lib/auth/client"

/* /app/* 受保護區 + 統一 app shell(精緻資料工具:單一頂欄 = 品牌 + 橫向導覽 + 帳號)。
   強制登入僅 production(對齊後端 TenantGuard dev/prod);登入後自動設 active org。
   導覽收進頂欄 → 左側只留內容自身的清單(如 builder 表單軌),不再雙軌。 */
const ENFORCED = process.env.NODE_ENV === "production"

const NAV = [
  { href: "/app/builder", label: "我的表單", icon: Table2 },
  { href: "/app", label: "記錄檢視", icon: LayoutGrid },
  { href: "/app/settings/security", label: "帳號安全", icon: ShieldCheck },
] as const

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  readonly href: string
  readonly label: string
  readonly icon: typeof Table2
  readonly active: boolean
}): ReactNode {
  return (
    <Link
      href={href}
      className={
        active
          ? "flex h-8 items-center gap-1.5 rounded-md bg-primary-t px-2.5 text-[12.5px] font-medium text-primary"
          : "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-ink-3 transition-colors duration-150 hover:bg-head hover:text-ink"
      }
    >
      <Icon size={15} strokeWidth={1.9} />
      {label}
    </Link>
  )
}

function ThemeMenu(): ReactNode {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeId>("navy")
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="配色主題"
        aria-label="配色主題"
        className="flex size-8 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-head hover:text-ink"
      >
        <Palette size={16} strokeWidth={1.9} />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-9 z-20 w-36 rounded-md border border-line bg-card p-1 shadow-md">
            {THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTheme(item.id)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-head"
              >
                <span
                  style={{ backgroundColor: item.hex }}
                  className="size-3.5 rounded-full border border-line"
                />
                {item.label}
                {theme === item.id ? <Check size={13} className="ml-auto text-primary" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

export default function AppLayout({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const { data: session, isPending } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const { data: orgs } = authClient.useListOrganizations()

  useEffect(() => {
    if (isPending) return
    if (ENFORCED && !session) {
      router.replace("/login")
      return
    }
    const first = orgs?.[0]
    if (session && !activeOrg && first) {
      void organization.setActive({ organizationId: first.id })
    }
  }, [isPending, session, activeOrg, orgs, router])

  if (ENFORCED && isPending) return <div className="p-6 text-[12px] text-ink-3">載入中…</div>
  if (ENFORCED && !session) return null

  const onLogout = async (): Promise<void> => {
    await signOut()
    router.replace("/login")
  }

  const isActive = (href: string): boolean =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-card px-3">
        <Link
          href="/app/builder"
          className="mr-1.5 flex size-8 items-center justify-center rounded-md bg-primary text-[13px] font-bold text-white shadow-xs"
          title="Weyver 織雲"
        >
          W
        </Link>
        <nav className="flex items-center gap-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href)}
            />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {activeOrg?.name ? (
            <span className="max-w-[180px] truncate text-[12px] font-medium text-ink-2">
              {activeOrg.name}
            </span>
          ) : null}
          {process.env.NODE_ENV !== "production" ? (
            <span className="rounded-xs border border-line px-1.5 py-px font-mono text-[9.5px] text-ink-4">
              dev
            </span>
          ) : null}
          <ThemeMenu />
          {session ? (
            <button
              type="button"
              onClick={() => void onLogout()}
              title={`登出(${session.user.email})`}
              aria-label="登出"
              className="flex size-8 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-er-t hover:text-er"
            >
              <LogOut size={16} strokeWidth={1.9} />
            </button>
          ) : null}
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  )
}
