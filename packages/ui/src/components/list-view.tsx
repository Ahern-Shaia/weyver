"use client"

import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useState } from "react"
import type { ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.10|列表(次要視圖)TanStack Table 實裝:可排序、selected 左 inset、禁斑馬 */
export interface ListViewProps<T> {
  readonly data: readonly T[]
  readonly columns: readonly ColumnDef<T, unknown>[]
  readonly getRowId: (row: T) => string
  readonly selectedId?: string
  readonly onRowClick?: (id: string) => void
  readonly className?: string
}

export function ListView<T>({
  data,
  columns,
  getRowId,
  selectedId,
  onRowClick,
  className,
}: ListViewProps<T>): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useReactTable({
    data: data as T[],
    columns: columns as ColumnDef<T, unknown>[],
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => getRowId(row),
  })

  return (
    <div className={cn("overflow-auto border border-line bg-card", className)}>
      <table className="w-full border-collapse">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                const canSort = header.column.getCanSort()
                return (
                  <th
                    key={header.id}
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                    }
                    className={cn(
                      "sticky top-0 border-b border-line bg-head px-3 py-[6px] text-[10.5px] font-semibold text-ink-2",
                      (header.column.columnDef.meta as { align?: string } | undefined)?.align ===
                        "right"
                        ? "text-right"
                        : "text-left",
                    )}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="font-mono text-[9px] text-ink-3">
                          {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "△"}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const selected = row.id === selectedId
            return (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onRowClick?.(row.id)
                }}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  onRowClick && "cursor-pointer",
                  selected
                    ? "bg-primary-t shadow-[inset_3px_0_0_var(--color-primary)]"
                    : "hover:bg-head",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      "border-b border-line-2 px-3 py-[5px] text-[12px]",
                      (cell.column.columnDef.meta as { align?: string } | undefined)?.align ===
                        "right" && "text-right font-mono tabular-nums",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
