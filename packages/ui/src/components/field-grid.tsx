import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.2|全框線欄位表:label 灰底靠右 112px + 值格,每格四邊 --color-cell 框線 */
export interface FieldItem {
  readonly label: ReactNode
  readonly value: ReactNode
  readonly required?: boolean
  readonly help?: boolean
  readonly mono?: boolean
  readonly note?: ReactNode
}

export interface FieldGridProps {
  readonly items: readonly FieldItem[]
  readonly columns?: 1 | 2
  readonly className?: string
}

export function FieldGrid({ items, columns = 2, className }: FieldGridProps): ReactElement {
  return (
    <div
      className={cn(
        "grid",
        columns === 2 ? "grid-cols-[112px_1fr_112px_1fr]" : "grid-cols-[112px_1fr]",
        className,
      )}
    >
      {items.map((item, index) => (
        <FieldCells
          key={typeof item.label === "string" ? item.label : `field-${index}`}
          item={item}
          columns={columns}
          index={index}
          total={items.length}
        />
      ))}
    </div>
  )
}

function FieldCells({
  item,
  columns,
  index,
  total,
}: {
  readonly item: FieldItem
  readonly columns: 1 | 2
  readonly index: number
  readonly total: number
}): ReactElement {
  const perRow = columns
  const lastRowStart = total - (total % perRow || perRow)
  const isLastRow = index >= lastRowStart
  const isRowEnd = (index + 1) % perRow === 0 || index === total - 1
  const borderB = isLastRow ? "" : "border-b"
  return (
    <>
      <div
        className={cn(
          "flex min-h-[32px] items-center justify-end gap-[3px] border-r border-cell bg-label px-2.5 py-[5px] text-right text-[11.5px] text-ink-2",
          borderB,
        )}
      >
        {item.required ? <span className="font-semibold text-er">*</span> : null}
        {item.label}
        {item.help ? (
          <span className="inline-flex size-3 items-center justify-center rounded-full border border-line-2 text-[10px] text-ink-3">
            ?
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "flex min-h-[32px] items-center gap-1.5 border-cell bg-card px-2.5 py-[5px] text-[12.5px]",
          borderB,
          isRowEnd ? "" : "border-r",
          item.mono && "font-mono tabular-nums",
        )}
      >
        {item.value}
        {item.note ? <span className="text-[10.5px] text-ink-3">{item.note}</span> : null}
      </div>
    </>
  )
}
