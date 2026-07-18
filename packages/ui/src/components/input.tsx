import type { InputHTMLAttributes, ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly icon?: ReactNode
}

export function Input({ className, icon, type = "text", ...props }: InputProps): ReactElement {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-[13px] shadow-sm",
        "transition-colors duration-[130ms] focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--color-brand-tint)]",
        className,
      )}
    >
      {icon ? <span className="text-ink-3 [&_svg]:size-3.5">{icon}</span> : null}
      <input
        type={type}
        className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-3 focus:outline-none"
        {...props}
      />
    </div>
  )
}
