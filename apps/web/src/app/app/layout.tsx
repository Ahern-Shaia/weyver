"use client"

import { applyTheme, THEMES, type ThemeId } from "@weyver/ui/theme-switcher"
import { Check, KeyRound, LayoutGrid, LogOut, Palette, ShieldCheck, Table2 } from "lucide-react"
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
import { CommandPalette } from "./_components/command-palette"
import { NotificationBell } from "./_components/notification-bell"
import { StatusBar } from "./_components/status-bar"

/* /app/* 受保護區 + app-shell(R1·UP-1:左 icon rail + 全域 status bar + ⌘K)。
   強制登入僅 production(對齊後端 TenantGuard dev/prod);登入後自動設 active org。
   單域 rail(只表單域;OQ-RWB-6=C)——不放空的業務域 tab(計算/生產/ISO R1 未起)。 */
const ENFORCED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENFORCE_AUTH === "1"

const NAV = [
  { href: "/app", label: "工作區", icon: LayoutGrid },
  { href: "/app/builder", label: "我的表單", icon: Table2 },
] as const

const SETTINGS_NAV = [
  { href: "/app/settings/permissions", label: "權限", icon: KeyRound },
  { href: "/app/settings/security", label: "帳號安全", icon: ShieldCheck },
] as const

function RailLink({
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
      title={label}
      aria-label={label}
      className={
        active
          ? "flex size-9 items-center justify-center rounded-md bg-primary-t text-primary"
          : "flex size-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-head hover:text-ink"
      }
    >
      <Icon size={18} strokeWidth={1.9} />
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
        className="flex size-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-head hover:text-ink"
      >
        <Palette size={17} strokeWidth={1.9} />
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
          <div className="absolute bottom-0 left-11 z-20 w-36 rounded-md border border-line bg-card p-1 shadow-md">
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
      <div className="flex min-h-0 flex-1">
        {/* 左 icon rail(單域) */}
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-card py-2.5">
          <Link
            href="/app"
            title="Weyver 織雲"
            className="mb-1.5 flex size-9 items-center justify-center rounded-md bg-primary text-[14px] font-bold text-white"
          >
            W
          </Link>
          {NAV.map((item) => (
            <RailLink key={item.href} {...item} active={isActive(item.href)} />
          ))}
          <div className="mt-auto flex flex-col items-center gap-1">
            <NotificationBell />
            {SETTINGS_NAV.map((item) => (
              <RailLink key={item.href} {...item} active={isActive(item.href)} />
            ))}
            <ThemeMenu />
            {session ? (
              <button
                type="button"
                onClick={() => void onLogout()}
                title={`登出(${session.user.email})`}
                aria-label="登出"
                className="flex size-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-er-t hover:text-er"
              >
                <LogOut size={17} strokeWidth={1.9} />
              </button>
            ) : null}
            {process.env.NODE_ENV !== "production" ? (
              <span className="font-mono text-[8.5px] text-ink-4">dev</span>
            ) : null}
          </div>
        </nav>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
      <StatusBar org={activeOrg?.name ?? null} />
      <CommandPalette />
    </div>
  )
}
