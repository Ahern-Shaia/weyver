import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.9|底部狀態列 26px:連線 · 同步時間戳 · 租戶 · 權限 · 版本 */
export interface StatusBarProps {
  readonly left: ReactNode
  readonly right?: ReactNode
  readonly className?: string
}

export function StatusBar({ left, right, className }: StatusBarProps): ReactElement {
  return (
    <div
      className={cn(
        "flex h-[26px] shrink-0 items-center gap-[18px] border-t border-line bg-head px-3.5 text-[10.5px] text-ink-3",
        className,
      )}
    >
      {left}
      <div className="flex-1" />
      {right}
    </div>
  )
}

export function StatusBarDot({ tone = "ok" }: { readonly tone?: "ok" | "error" }): ReactElement {
  return (
    <span
      className={cn("mr-1 inline-block size-1.5 rounded-full", tone === "ok" ? "bg-ok" : "bg-er")}
    />
  )
}
