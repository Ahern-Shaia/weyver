"use client"

import {
  authClient,
  organization,
  signOut,
  useActiveOrganization,
  useSession,
} from "@/lib/auth/client"
import { setTabOrgIntent } from "@/lib/engine/client"
import { useQueryClient } from "@tanstack/react-query"
import { THEMES, type ThemeId, applyTheme } from "@weyver/ui/theme-switcher"
import {
  Check,
  LayoutGrid,
  LogOut,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Table2,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CommandPalette } from "./_components/command-palette"
import { NotificationBell } from "./_components/notification-bell"
import { StatusBar } from "./_components/status-bar"
import { TenantContextGuard } from "./_components/tenant-context-guard"

/* /app/* 受保護區 + app-shell(左側導覽 + 全域 status bar + ⌘K)。
   強制登入僅 production(對齊後端 TenantGuard dev/prod);登入後自動設 active org。
   單域導覽(只表單域;OQ-RWB-6=C)——不放空的業務域 tab(計算/生產/ISO R1 未起)。

   🔴 R1·UX-1 M2|由 10 個純圖示改為「預設展開含文字標籤、可收合成圖示態」。
   依據:Material 3 明載 collapsed rail 目的地 3–7 個、**>7 必須改用 expanded rail**;
   WinUI 明載 icon-only 為**空間不足時的降級態**非預設;NN/g 明載文字標籤
   **須隨時可見不靠 hover**。設定六項收進單一入口(S22 設定中心),
   同批把六項全數加進 ⌘K —— 否則它們會同時失去「一次點擊」與「鍵盤可達」。 */
const ENFORCED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENFORCE_AUTH === "1"

const NAV = [
  { href: "/app", label: "工作區", icon: LayoutGrid },
  { href: "/app/builder", label: "我的表單", icon: Table2 },
  { href: "/app/settings", label: "設定", icon: Settings2 },
] as const

/* 收合偏好跨分頁共用是正確的(純 UI 偏好,非租戶上下文)——
   與 F-10 刻意不用 localStorage 存 org 的理由不同,那裡的跨分頁共用正是缺陷本身。 */
const RAIL_KEY = "weyver.rail.collapsed"

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
}: {
  readonly href: string
  readonly label: string
  readonly icon: typeof Table2
  readonly active: boolean
  readonly collapsed: boolean
}): ReactNode {
  const base =
    "flex items-center rounded-sm transition-colors duration-fast-01 ease-productive-exit"
  /* 🔴 v4 方向 B|導覽項**不畫框**,靠狀態階(hover=s3 / active=s4)。
     這是 docs/29 S1 的落地:量測顯示現行 78 個帶框元素中 65 個是按鈕,
     Directus 同指標只有 1 個 —— 互動項各自畫框正是「雜亂」的來源。 */
  const tone = active
    ? "bg-active font-medium text-ink"
    : "text-ink-2 hover:bg-hover hover:text-ink"
  return (
    <Link
      href={href}
      /* 收合態才需要 tooltip;展開態文字已在,重複的 title 只會製造噪音 */
      {...(collapsed ? { title: label } : {})}
      aria-label={label}
      className={`${base} ${tone} ${collapsed ? "size-9 justify-center" : "h-8 gap-2.5 px-2.5 text-[14px]"}`}
    >
      <Icon size={17} strokeWidth={1.9} className="shrink-0" />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  )
}

function ThemeMenu({ collapsed }: { readonly collapsed: boolean }): ReactNode {
  const [open, setOpen] = useState(false)
  /* 同通知面板:導覽軌的 `overflow-y-auto` 會把絕對定位的選單裁在軌寬邊界。
     這個選單 144px + 左偏 44px = 188px > 172px,右側 16px 被切掉 —— 幅度小到
     容易被當成「就長這樣」,但成因與通知面板完全相同。 */
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [theme, setTheme] = useState<ThemeId>("thread")
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (!open && btnRef.current !== null) {
            const r = btnRef.current.getBoundingClientRect()
            setAnchor({ left: r.right + 8, bottom: window.innerHeight - r.bottom })
          }
          setOpen((v) => !v)
        }}
        {...(collapsed ? { title: "配色主題" } : {})}
        aria-label="配色主題"
        className={`flex items-center rounded-sm text-ink-2 transition-colors duration-fast-01 ease-productive-exit hover:bg-hover hover:text-ink ${
          collapsed ? "size-9 justify-center" : "h-8 w-full gap-2.5 px-2.5 text-[13px]"
        }`}
      >
        <Palette size={17} strokeWidth={1.9} className="shrink-0" />
        {collapsed ? null : <span>配色主題</span>}
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
          <div
            style={anchor === null ? undefined : { left: anchor.left, bottom: anchor.bottom }}
            className="fixed z-20 w-36 rounded-md border border-line bg-card p-1 shadow-md"
          >
            {THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTheme(item.id)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-ink-2 transition-colors duration-fast-01 ease-productive-exit hover:bg-head"
              >
                {/* 色塊吃該主題的 var(--color-primary),不存 hex(見 theme-switcher 檔頭) */}
                <span
                  {...(item.id === "thread" ? {} : { "data-theme": item.id })}
                  className="size-3.5 rounded-full border border-line bg-primary"
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
  const { data: activeOrg, isPending: orgPending } = useActiveOrganization()
  const { data: orgs } = authClient.useListOrganizations()

  /* 預設展開(WinUI:icon-only 是降級態不是預設);偏好於掛載後才套用,
     避免 SSR 與 client 首次 render 不一致造成版面跳動(CLS)。 */
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    if (window.localStorage.getItem(RAIL_KEY) === "1") setCollapsed(true)
  }, [])

  /* 🔴 F-10|把「這個分頁在哪家公司」釘進 HTTP client。

     必須在其他請求發出**之前**設定,否則首批請求會退回 session 行為。
     值取自 `useActiveOrganization()`(這個 hook 的值是本分頁 render 時的快照),
     **不從 localStorage 取** —— localStorage 跨分頁共用,用它等於換個地方犯同樣的錯。 */
  useEffect(() => {
    setTabOrgIntent(activeOrg?.id ?? null)
  }, [activeOrg?.id])

  /* 🔴 切公司 → 丟棄整份查詢快取。

     query key 是 `["forms"]` 這種不含租戶的形狀,若不清,切公司後 React Query
     會把**前一家公司的快取**當成現有資料直接顯示(isLoading=false),直到重取完成。
     這不是命名空間問題而是語意問題:**換公司後手上的資料全部來自別家,應該作廢。**
     加 keepPreviousData(M7)會讓這個既有缺陷更明顯,故先修。 */
  const queryClient = useQueryClient()
  const prevOrg = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    /* 🔴 **解析完成前不得判定「換公司」**。
       `useActiveOrganization()` 載入中時 `data` 為 undefined,`?? null` 會讓它
       看起來像「沒有公司」;等真實 org 到達就被誤判成一次切換 →
       `clear()` 把**剛飛回來的查詢連同進行中的請求一起清掉**,
       頁面因此永遠停在載入中(實測:登入後首次進入成員頁必現)。
       登入後第一次解析是**初始化不是切換**,故等 pending 結束再記錄基準。 */
    if (orgPending) return
    const id = activeOrg?.id ?? null
    if (prevOrg.current !== undefined && prevOrg.current !== id) queryClient.clear()
    prevOrg.current = id
  }, [activeOrg?.id, orgPending, queryClient])

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
    /* ⚠️ 用 client 導向,**不要**改成 `window.location.href`。
       曾經為了修「偶發停在原頁」而改成全頁導向 —— 那會強制重抓 HTML 與 chunk,
       在 dev server 下反而穩定地變慢(實測:auth / mfa 兩支 e2e 從偶發紅變成必紅)。
       登出後停在原頁的真正原因是導向需要時間,不是導向沒發生。 */
    router.replace("/login")
  }

  const isActive = (href: string): boolean =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href)

  /* 根層 overflow-auto(非 hidden):正常情況內容剛好填滿視窗、不出現捲軸;
     只有內容真的溢出時才捲 —— 即 WCAG 1.4.12「使用者加大行高/字距」的情境,
     此時內容可捲到而非被永久裁掉。

     🔴 `main` 為**垂直捲動的擁有者**(#140)。
     沒有它的話,內容長的頁面會讓**整個 app shell** 一起捲:實測 integrations 與 trash
     的導覽軌位移 1200px、狀態列跑到 -520(捲出畫面),notifications 位移 107。
     逐頁自己加 `h-full overflow-y-auto` 已被證實靠不住 —— 三頁漏掉,
     而正確的那幾頁是各自記得加的。捲動的擁有權應該由 shell 保證,不是逐頁自律。

     ⚠️ **此處原本有一條禁令**:「不可在 main 上加 overflow,會使右側面板蓋住工具列
     (實測 designer / image-* e2e 失敗)」。**該禁令的成因已於 #140 移除** ——
     真正的問題不是 main 自成捲動容器,而是**設計器工具列自己會溢出**
     (單一 flex row + `ml-auto`,無 min-w-0 無 overflow)。工具列拆成
     「左側可捲 + 右側固定」之後,加上 overflow-y 實測 designer / image-* /
     layout-narrow 共 13 條全綠。**限制是真的,但它的成因變了。** */
  return (
    <div className="flex h-screen flex-col overflow-auto bg-surface">
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="主導覽"
          /* overflow-y-auto:WCAG 1.4.12 —— 使用者加大行高/字距時導覽項會變高,
             沒有自己的捲動就會被 app-shell 的 overflow-hidden 裁掉而搆不到 */
          className={`flex shrink-0 flex-col gap-0.5 overflow-y-auto bg-nav py-3 ${
            collapsed ? "w-13 items-center px-0" : "w-[196px] px-2.5"
          }`}
        >
          <Link
            href="/app"
            {...(collapsed ? { title: "Weyver 織雲 — 回工作區" } : {})}
            aria-label="Weyver 織雲 — 回工作區"
            className={`mb-4 flex items-center rounded-sm ${collapsed ? "justify-center" : "gap-2.5 px-0.5"}`}
          >
            {/* v4|軌已改中性,記號回到**深色實方塊**:在淺色殼裡它是畫面上
                唯一的深色實體,那就是它的存在感來源 —— 不需要一整條側欄替它宣告。 */}
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-ink text-[14px] font-bold tracking-[-0.04em] text-card">
              W
            </span>
            {/* 產品名而非租戶名 —— 租戶身分歸狀態列(docs/14 §3.1);
                兩處都顯示是冗餘,且會讓「這是哪家公司」出現兩個真實來源。 */}
            {collapsed ? null : (
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[14px] font-semibold tracking-[-0.012em] text-ink">
                  Weyver
                </span>
                <span className="truncate text-[12px] tracking-[0.14em] text-ink-3">織雲</span>
              </span>
            )}
          </Link>

          {NAV.map((item) => (
            <NavItem key={item.href} {...item} active={isActive(item.href)} collapsed={collapsed} />
          ))}

          <div className="mt-auto flex flex-col gap-0.5">
            <NotificationBell collapsed={collapsed} />
            <ThemeMenu collapsed={collapsed} />
            {session ? (
              <button
                type="button"
                onClick={() => void onLogout()}
                {...(collapsed ? { title: `登出(${session.user.email})` } : {})}
                aria-label="登出"
                className={`flex items-center rounded-sm text-ink-2 transition-colors duration-fast-01 ease-productive-exit hover:bg-hover hover:text-ink ${
                  collapsed ? "size-9 justify-center" : "h-8 gap-2.5 px-2.5 text-[13px]"
                }`}
              >
                <LogOut size={17} strokeWidth={1.9} className="shrink-0" />
                {collapsed ? null : <span className="truncate">登出</span>}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setCollapsed((v) => {
                  const next = !v
                  window.localStorage.setItem(RAIL_KEY, next ? "1" : "0")
                  return next
                })
              }}
              title={collapsed ? "展開導覽" : "收合導覽"}
              aria-label={collapsed ? "展開導覽" : "收合導覽"}
              aria-expanded={!collapsed}
              className={`mt-0.5 flex items-center rounded-sm text-ink-3 transition-colors duration-fast-01 ease-productive-exit hover:bg-hover hover:text-ink ${
                collapsed ? "size-9 justify-center" : "h-7 gap-2.5 px-2.5 text-[12px]"
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen size={16} strokeWidth={1.9} />
              ) : (
                <>
                  <PanelLeftClose size={16} strokeWidth={1.9} className="shrink-0" />
                  <span>收合</span>
                </>
              )}
            </button>

            {process.env.NODE_ENV !== "production" ? (
              <span
                className={`font-mono text-[12px] text-ink-3 ${collapsed ? "text-center" : "px-2.5"}`}
              >
                dev
              </span>
            ) : null}
          </div>
        </nav>
        {/* 🔴 v4 方向 B|內容面**比應用底更亮**並以圓角浮起,左側一條 hairline
            取代 border —— 深度靠明度差,不靠框(docs/29 S2)。 */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-l-lg bg-card shadow-[-1px_0_0_var(--color-line)]">
          <TenantContextGuard>{children}</TenantContextGuard>
        </main>
      </div>
      <StatusBar org={activeOrg?.name ?? null} />
      <CommandPalette />
    </div>
  )
}
