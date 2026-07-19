"use client"

import { ThemeSwitcher } from "@weyver/ui/theme-switcher"
import { LayoutGrid, LogOut, ShieldCheck, Table2 } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import {
  authClient,
  organization,
  signOut,
  useActiveOrganization,
  useSession,
} from "@/lib/auth/client"

/* /app/* 受保護區 + 統一 app shell(精緻資料工具:窄圖示導覽軌 + 單一頂欄 context)。
   強制登入僅 production(對齊後端 TenantGuard dev/prod);登入後自動設 active org。 */
const ENFORCED = process.env.NODE_ENV === "production"

const NAV = [
  { href: "/app/builder", label: "我的表單", icon: Table2 },
  { href: "/app", label: "記錄檢視", icon: LayoutGrid },
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
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "flex size-9 items-center justify-center rounded-md bg-primary-t text-primary"
          : "flex size-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-head hover:text-ink"
      }
    >
      <Icon size={17} strokeWidth={1.9} />
    </Link>
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
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* 窄圖示導覽軌 */}
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-line bg-card py-2.5">
        <Link
          href="/app/builder"
          className="flex size-8 items-center justify-center rounded-md bg-primary text-[13px] font-bold text-white shadow-xs"
          title="Weyver 織雲"
        >
          W
        </Link>
        <nav className="mt-4 flex flex-col gap-1.5">
          {NAV.map((item) => (
            <RailLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href)}
            />
          ))}
        </nav>
        {session ? (
          <button
            type="button"
            onClick={() => void onLogout()}
            title="登出"
            aria-label="登出"
            className="mt-auto flex size-9 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-er-t hover:text-er"
          >
            <LogOut size={17} strokeWidth={1.9} />
          </button>
        ) : null}
      </aside>

      {/* 主區:單一頂欄 context + 內容 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-card px-4">
          <span className="text-[13px] font-semibold text-ink">
            {activeOrg?.name ?? "織雲工作區"}
          </span>
          {process.env.NODE_ENV !== "production" ? (
            <span className="rounded-xs border border-line px-1.5 py-px font-mono text-[9.5px] text-ink-4">
              dev
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <ThemeSwitcher />
            {session ? <span className="text-[12px] text-ink-3">{session.user.email}</span> : null}
          </div>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
