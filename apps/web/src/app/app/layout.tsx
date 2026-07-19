"use client"

import { Button } from "@weyver/ui/button"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import {
  authClient,
  organization,
  signOut,
  useActiveOrganization,
  useSession,
} from "@/lib/auth/client"

/* /app/* 受保護區。強制登入只在 production 生效 —— 對齊後端 TenantGuard 的 dev/prod 分派:
   dev/test 後端走 DevTenantGuard(x-dev-tenant),前端不擋(引擎 e2e 與本機工作流不需登入);
   prod 後端走 AuthGuard(session→tenant),前端未登入 → /login。
   已登入時:無 active org 但有 org → 自動設第一個(確保 AuthGuard 能解析 tenant);
   頂部細帶顯示公司 + 帳號 + 登出。 */
const ENFORCED = process.env.NODE_ENV === "production"

export default function AppLayout({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter()
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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {session ? (
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-head px-3">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="flex size-5 items-center justify-center rounded-sm bg-primary text-[10px] font-bold text-white">
              W
            </span>
            <span className="font-medium text-ink-2">{activeOrg?.name ?? "織雲工作區"}</span>
          </div>
          <div className="flex items-center gap-2.5 text-[12px] text-ink-3">
            <span className="hidden sm:inline">{session.user.email}</span>
            <Link href="/app/settings/security" className="text-ink-2 hover:text-primary">
              安全
            </Link>
            <Button variant="default" onClick={() => void onLogout()}>
              登出
            </Button>
          </div>
        </header>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
