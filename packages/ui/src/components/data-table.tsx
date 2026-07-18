import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

export interface Column<T> {
  readonly key: string
  readonly header: string
  readonly align?: "left" | "right"
  readonly render: (row: T) => ReactNode
  readonly cellClassName?: string
}

export interface DataTableProps<T> {
  readonly columns: readonly Column<T>[]
  readonly data: readonly T[]
  readonly getRowKey: (row: T, index: number) => string
  readonly className?: string
}

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  className,
}: DataTableProps<T>): ReactElement {
  return (
    <div className={cn("overflow-hidden rounded-md border border-border", className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "border-b border-border-2 bg-head px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-ink-3",
                  column.align === "right" ? "text-right" : "text-left",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr
              key={getRowKey(row, index)}
              className="transition-colors duration-[130ms] hover:bg-surface"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "border-b border-border-3 px-3.5 py-2.5 text-[12.5px] [tr:last-child_&]:border-b-0",
                    column.align === "right" && "text-right font-mono tabular-nums",
                    column.cellClassName,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
