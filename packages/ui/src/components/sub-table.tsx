import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.3|子表:列號欄 + 直欄線(全框)+ 數字右對齊 Mono + 合計列 + 新增一列 */
export interface SubTableColumn<T> {
  readonly key: string
  readonly header: ReactNode
  readonly align?: "left" | "right"
  readonly width?: string
  readonly render: (row: T, index: number) => ReactNode
}

export interface SubTableProps<T> {
  readonly columns: readonly SubTableColumn<T>[]
  readonly data: readonly T[]
  readonly getRowKey: (row: T, index: number) => string
  /** 合計列:key → 內容(未列之欄留空);整列 fx 底 + 2px 頂線 */
  readonly sumRow?: Readonly<Record<string, ReactNode>>
  readonly sumLabel?: ReactNode
  readonly onAddRow?: () => void
  readonly className?: string
}

export function SubTable<T>({
  columns,
  data,
  getRowKey,
  sumRow,
  sumLabel,
  onAddRow,
  className,
}: SubTableProps<T>): ReactElement {
  return (
    <div className={className}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="w-[34px] border border-t-0 border-cell bg-head px-2 py-[5px] text-center text-[12px] font-semibold text-ink-2">
              #
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  "border border-t-0 border-cell bg-head px-2 py-[5px] text-[12px] font-semibold text-ink-2",
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
            <tr key={getRowKey(row, index)}>
              <td className="border border-cell bg-head px-2 py-[5px] text-center font-mono text-[12px] text-ink-3">
                {index + 1}
              </td>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "border border-cell px-2 py-[5px] text-[12px]",
                    column.align === "right" && "text-right font-mono tabular-nums",
                  )}
                >
                  {column.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
          {sumRow ? (
            <tr>
              <td className="border border-cell border-t-2 border-t-fx bg-fx-bg" />
              {columns.map((column, columnIndex) => (
                <td
                  key={column.key}
                  className={cn(
                    "border border-cell border-t-2 border-t-fx bg-fx-bg px-2 py-[5px] text-[12px] font-semibold text-fx",
                    column.align === "right" && "text-right font-mono tabular-nums",
                  )}
                >
                  {columnIndex === 0 && sumLabel !== undefined ? sumLabel : sumRow[column.key]}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
      {onAddRow ? (
        <button
          type="button"
          onClick={onAddRow}
          className="px-2 py-1 text-[12px] text-link underline underline-offset-2"
        >
          + 新增一列
        </button>
      ) : null}
    </div>
  )
}
