import type { HTMLAttributes, ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 §3.7 / §0.1|帶框方形狀態章(字/框/底三值),文字必有;禁 pill、禁裝飾圓點。
   狀態層級(§0.1 資訊設計):**要行動**的狀態(待審 warn / 退回 error)留語意色;
   **已了結 / settled**(已核准 / 已收貨 / 完成)用 `neutral` 退到背景,不用 ok 綠——
   讓注意力導向該處理的,而非一片綠與待辦爭注意力。 */
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
