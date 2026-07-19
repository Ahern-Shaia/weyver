import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.2|分段:扁平主色實底標題條 + 框線面板(禁陰影) */
export interface FormSectionProps {
  readonly title: ReactNode
  readonly hint?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

export function FormSection({ title, hint, children, className }: FormSectionProps): ReactElement {
  return (
    <section className={cn("border border-line border-b-0 bg-card last:border-b", className)}>
      <header className="flex items-center bg-primary px-3 py-1.5 text-[12px] font-semibold tracking-[.02em] text-white">
        {title}
        {hint ? <span className="ml-auto text-[10.5px] font-normal opacity-80">{hint}</span> : null}
      </header>
      {children}
    </section>
  )
}
