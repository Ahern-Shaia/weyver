"use client"

import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.1|topbar 42px:品牌 + 客戶自建 app 頁籤(active=主色實底)+ 右側槽 */
export interface AppTab {
  readonly id: string
  readonly label: string
}

export interface TopBarProps {
  readonly tabs: readonly AppTab[]
  readonly activeTab: string
  readonly onTabSelect?: (id: string) => void
  readonly right?: ReactNode
  readonly className?: string
}

export function TopBar({
  tabs,
  activeTab,
  onTabSelect,
  right,
  className,
}: TopBarProps): ReactElement {
  return (
    <div
      className={cn(
        "flex h-[42px] shrink-0 items-stretch border-b-2 border-primary bg-card pl-3",
        className,
      )}
    >
      <div className="flex items-center gap-2 pr-4">
        <div className="flex size-[22px] items-center justify-center rounded-sm bg-primary text-[11.5px] font-bold text-white">
          W
        </div>
        <span className="text-[13px] font-semibold">
          Weyver <span className="text-[11px] font-normal text-ink-3">織雲</span>
        </span>
      </div>
      <nav className="flex items-stretch" aria-label="應用">
        {tabs.map((tab) => {
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onTabSelect?.(tab.id)}
              className={cn(
                "-mb-0.5 flex items-center border-b-2 border-transparent px-[15px] text-[12.5px]",
                active ? "bg-primary font-semibold text-white" : "text-ink-2 hover:bg-head",
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2 pr-3">{right}</div>
    </div>
  )
}
