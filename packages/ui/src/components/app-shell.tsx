import { Bell, Plus, Search } from "lucide-react"
import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

export interface NavItem {
  readonly icon: ReactNode
  readonly label: string
  readonly active?: boolean
  readonly meta?: string
}

export interface NavSection {
  readonly label?: string
  readonly items: readonly NavItem[]
}

export interface AppShellProps {
  readonly tenantName: string
  readonly nav: readonly NavSection[]
  readonly actions?: ReactNode
  readonly children: ReactNode
}

export function AppShell({ tenantName, nav, actions, children }: AppShellProps): ReactElement {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-border bg-card px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-sm bg-brand text-[13px] font-bold tracking-tight text-white">
            W
          </div>
          <span className="text-[13px] font-semibold tracking-tight">
            Weyver <span className="font-normal text-ink-3">織雲</span>
          </span>
        </div>

        <label className="ml-2 flex h-8 max-w-[360px] flex-1 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-[13px] text-ink-3 focus-within:border-brand">
          <Search className="size-3.5" strokeWidth={1.5} />
          <input
            type="search"
            placeholder="全域搜尋單據 · 表單 · 供應商…"
            className="min-w-0 flex-1 bg-transparent placeholder:text-ink-3 focus:outline-none"
          />
          <kbd className="rounded-[4px] border border-border-2 bg-card px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
            ⌘K
          </kbd>
        </label>

        <div className="ml-auto flex items-center gap-2">
          {actions ?? (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-sm bg-brand px-3 py-1.5 text-[13px] font-medium text-white transition-colors duration-[130ms] hover:bg-brand-hover"
              >
                <Plus className="size-3.5" strokeWidth={2} />
                建立
              </button>
              <button
                type="button"
                aria-label="通知"
                className="flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-surface"
              >
                <Bell className="size-4" strokeWidth={1.6} />
              </button>
              <div className="flex size-8 items-center justify-center rounded-full bg-brand text-[12px] font-semibold text-white">
                鮮
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1">
        <nav className="flex w-[216px] shrink-0 flex-col gap-4 border-r border-border bg-card px-3 py-4">
          <div className="rounded-sm bg-brand-tint px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
              工作區
            </div>
            <div className="mt-0.5 text-[13px] font-semibold text-brand">{tenantName}</div>
          </div>

          {nav.map((section, sectionIndex) => (
            <div key={section.label ?? `section-${sectionIndex}`} className="flex flex-col gap-0.5">
              {section.label ? (
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-4">
                  {section.label}
                </div>
              ) : null}
              {section.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-current={item.active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[13px] transition-colors duration-[130ms] [&_svg]:size-4",
                    item.active
                      ? "bg-brand-tint font-semibold text-brand"
                      : "text-ink-2 hover:bg-surface",
                  )}
                >
                  <span className={item.active ? "text-brand" : "text-ink-3"}>{item.icon}</span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.meta ? (
                    <span className="font-mono text-[11px] text-ink-3 tabular-nums">
                      {item.meta}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1280px] px-6 py-5">{children}</div>
        </main>
      </div>
    </div>
  )
}
