import type { HTMLAttributes, ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.7|帶框方形狀態章(字/框/底三值),文字必有;禁 pill */
export type StatusTone = "ok" | "warn" | "error" | "neutral"

const toneClass: Record<StatusTone, string> = {
  ok: "text-ok border-ok-line bg-ok-t",
  warn: "text-wn border-wn-line bg-wn-t",
  error: "text-er border-er-line bg-er-t",
  neutral: "text-nt border-nt-line bg-nt-t",
}

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: StatusTone
}

export function StatusChip({
  tone = "neutral",
  className,
  children,
  ...props
}: StatusChipProps): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex h-[17px] items-center gap-1 rounded-xs border px-[5px] text-[10.5px] font-medium",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
