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
        "flex h-[27px] items-center gap-1.5 rounded-xs border border-line bg-card px-2 text-[12px]",
        "focus-within:border-primary",
        className,
      )}
    >
      {icon ? <span className="text-ink-4 [&_svg]:size-3">{icon}</span> : null}
      <input
        type={type}
        className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-4 focus:outline-none"
        {...props}
      />
    </div>
  )
}
