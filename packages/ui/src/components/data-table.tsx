import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.10|列表(次要視圖):hairline + 表頭 head 底、數字右對齊 Mono、禁斑馬、~28px 列高 */
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
  readonly selectedKey?: string
  readonly className?: string
}

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  selectedKey,
  className,
}: DataTableProps<T>): ReactElement {
  return (
    <div className={cn("overflow-hidden border border-line", className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "border-b border-line bg-head px-3 py-[6px] text-[12px] font-semibold text-ink-2",
                  column.align === "right" ? "text-right" : "text-left",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => {
            const key = getRowKey(row, index)
            const selected = key === selectedKey
            return (
              <tr
                key={key}
                className={cn(
                  selected
                    ? "bg-primary-t shadow-[inset_3px_0_0_var(--color-primary)]"
                    : "hover:bg-head",
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "border-b border-line-2 px-3 py-[5px] text-[12px] [tr:last-child_&]:border-b-0",
                      column.align === "right" && "text-right font-mono tabular-nums",
                      column.cellClassName,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
