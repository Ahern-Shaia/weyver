import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* tokens v3.0|分段:精緻卡片(圓角 + 淺底 header + primary 小圓點 + 極淡層次),非實心主色條 */
export interface FormSectionProps {
  readonly title: ReactNode
  readonly hint?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

export function FormSection({ title, hint, children, className }: FormSectionProps): ReactElement {
  return (
    <section
      className={cn("overflow-hidden rounded-md border border-line bg-card shadow-xs", className)}
    >
      <header className="flex items-center gap-2 border-b border-line bg-head px-3.5 py-2 text-[11.5px] font-semibold text-ink-2">
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
        {title}
        {hint ? <span className="ml-auto text-[10.5px] font-normal text-ink-4">{hint}</span> : null}
      </header>
      {children}
    </section>
  )
}
