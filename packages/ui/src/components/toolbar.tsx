"use client"

import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.8|工具列 40px:麵包屑 + 帶框按鈕(單一 primary)+ 記錄導航必備 */
export interface ToolbarProps {
  readonly crumb?: ReactNode
  readonly children?: ReactNode
  readonly right?: ReactNode
  readonly className?: string
}

export function Toolbar({ crumb, children, right, className }: ToolbarProps): ReactElement {
  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-card px-3.5",
        className,
      )}
    >
      {crumb ? <span className="mr-2 text-[11.5px] text-ink-3">{crumb}</span> : null}
      {children}
      <div className="flex-1" />
      {right}
    </div>
  )
}

export interface RecordNavProps {
  readonly index: number
  readonly total: number
  readonly onPrev?: () => void
  readonly onNext?: () => void
  readonly className?: string
}

export function RecordNav({
  index,
  total,
  onPrev,
  onNext,
  className,
}: RecordNavProps): ReactElement {
  return (
    <div
      className={cn(
        "inline-flex h-[27px] items-center overflow-hidden rounded-xs border border-line",
        className,
      )}
    >
      <button
        type="button"
        aria-label="上一筆"
        onClick={onPrev}
        disabled={index <= 1}
        className="flex h-full w-[26px] items-center justify-center border-r border-line text-ink-3 hover:bg-head disabled:opacity-40"
      >
        ‹
      </button>
      <span className="border-r border-line px-2.5 font-mono text-[11px] text-ink-2 tabular-nums">
        第 {index} / {total} 筆
      </span>
      <button
        type="button"
        aria-label="下一筆"
        onClick={onNext}
        disabled={index >= total}
        className="flex h-full w-[26px] items-center justify-center text-ink-3 hover:bg-head disabled:opacity-40"
      >
        ›
      </button>
    </div>
  )
}
