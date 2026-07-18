import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

export interface ModuleCardProps {
  readonly icon: ReactNode
  readonly name: string
  readonly meta: string
  readonly value?: string
  readonly className?: string
}

export function ModuleCard({ icon, name, meta, value, className }: ModuleCardProps): ReactElement {
  return (
    <div
      className={cn(
        "flex min-w-[260px] items-center gap-3 rounded-md border border-border bg-card px-3.5 py-3",
        "transition-[box-shadow,border-color] duration-[130ms] hover:border-brand-tint-2 hover:shadow-md",
        className,
      )}
    >
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-sm border border-border-2 bg-surface text-brand [&_svg]:size-[17px]">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold">{name}</div>
        <div className="mt-0.5 text-[11px] text-ink-3">{meta}</div>
      </div>
      {value ? (
        <div className="ml-auto font-mono text-base font-semibold tracking-tight tabular-nums">
          {value}
        </div>
      ) : null}
    </div>
  )
}
