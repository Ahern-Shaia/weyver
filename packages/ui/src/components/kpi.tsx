import { ArrowDown, ArrowUp } from "lucide-react"
import type { ReactElement } from "react"
import { cn } from "../lib/utils"

export interface KpiTrend {
  readonly direction: "up" | "down"
  readonly label: string
}

export interface KpiNote {
  readonly tone?: "muted" | "danger"
  readonly label: string
}

export interface KpiProps {
  readonly label: string
  readonly value: string | number
  readonly unit?: string
  readonly trend?: KpiTrend
  readonly note?: KpiNote
  readonly className?: string
}

export function Kpi({ label, value, unit, trend, note, className }: KpiProps): ReactElement {
  return (
    <div
      className={cn("min-w-[170px] rounded-md border border-border bg-card px-4 py-3.5", className)}
    >
      <div className="mb-2 text-[11px] font-medium text-ink-3">{label}</div>
      <div className="font-mono text-[22px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
        {unit ? <span className="ml-0.5 text-[11px] font-medium text-ink-3">{unit}</span> : null}
      </div>
      {trend ? (
        <div
          className={cn(
            "mt-2 flex items-center gap-1 text-[11px] font-medium",
            trend.direction === "up" ? "text-success-dark" : "text-danger-dark",
          )}
        >
          {trend.direction === "up" ? (
            <ArrowUp className="size-2.5" strokeWidth={2.4} />
          ) : (
            <ArrowDown className="size-2.5" strokeWidth={2.4} />
          )}
          {trend.label}
        </div>
      ) : null}
      {note ? (
        <div
          className={cn(
            "mt-2 text-[11px]",
            note.tone === "danger" ? "font-medium text-danger-dark" : "text-ink-3",
          )}
        >
          {note.label}
        </div>
      ) : null}
    </div>
  )
}
