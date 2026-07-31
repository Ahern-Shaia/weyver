import type { InputHTMLAttributes, ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §2.6|輸入高 26-28px、方角 2px、框線 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly icon?: ReactNode
}

export function Input({ className, icon, type = "text", ...props }: InputProps): ReactElement {
  return (
    <div
      className={cn(
        /* min-h 而非 h —— WCAG 1.4.12:使用者加大行高/字距時版面不得裁切 */
        "flex min-h-[27px] items-center gap-1.5 rounded-xs border border-line-input bg-card px-2 text-[13px]",
        "focus-within:border-primary",
        className,
      )}
    >
      {icon ? <span className="text-ink-3 [&_svg]:size-3">{icon}</span> : null}
      <input
        type={type}
        className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-3 focus:outline-none"
        {...props}
      />
    </div>
  )
}
