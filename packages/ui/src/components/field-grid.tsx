import type { ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.2|全框線欄位表:label 灰底靠右 112px + 值格,每格四邊 --color-cell 框線 */
export interface FieldItem {
  readonly label: ReactNode
  readonly value: ReactNode
  readonly required?: boolean
  /* 傳字串 = 把說明文字掛在 `?` 上(title + aria-label);傳 `true` = 只有記號沒有內容。
     🔴 2026-08-03:原本只收 boolean —— 設計器讓使用者打了說明文字,填單卻只渲染
     一個點不出東西的 `?`。**有記號沒內容比沒有記號更糟**,使用者會一直找那段說明。 */
  readonly help?: boolean | string
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

/* 🔴 R1·UP-3c M1|把「一個欄位＝label 格 + 值格」抽成可共用原件。

   Ragic 官方逐字:「**一個欄位會佔兩格儲存格的空間,左邊是欄位名稱(也稱為欄位標頭),
   右邊是欄位值**」—— 這一對就是表單的最小單位。

   ⚠️ **共用的是「格子」不是「容器」**。OQ-FDW-2=A 原文寫「完全共用 FieldGrid」,
   實作時發現兩者**排版模型不同**:填單是流式(items 依序),設計畫布是 12 欄座標
   定位(row/col/span)。硬套會弄壞座標系統。故共用降到**格子層** ——
   視覺語言不會漂移(那是「設計即所見」的價值所在),各自保有排版模型。
   此為對 OQ-FDW-2 的實作層修正,已記錄於 M0。 */
export function FieldCellPair({
  item,
  borderB = true,
  borderR = true,
  flush = false,
}: {
  readonly item: FieldItem
  readonly borderB?: boolean
  readonly borderR?: boolean
  /* flush:值格不留內距,交給裡面的輸入元件自己撐滿(填單用)。
     不 flush 時值格自帶內距(檢視用),否則文字會貼著框線。 */
  readonly flush?: boolean
}): ReactElement {
  return <Cells item={item} borderB={borderB ? "border-b" : ""} isRowEnd={!borderR} flush={flush} />
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
  return (
    <Cells item={item} borderB={isLastRow ? "" : "border-b"} isRowEnd={isRowEnd} flush={false} />
  )
}

function Cells({
  item,
  borderB,
  isRowEnd,
  flush,
}: {
  readonly item: FieldItem
  readonly borderB: string
  readonly isRowEnd: boolean
  readonly flush: boolean
}): ReactElement {
  return (
    <>
      <div
        className={cn(
          "flex min-h-[32px] min-w-0 items-center justify-end gap-[3px] border-cell border-r bg-label px-2.5 py-[5px] text-right text-[12px] text-ink-2",
          borderB,
        )}
      >
        {item.required ? <span className="font-semibold text-er">*</span> : null}
        {item.label}
        {item.help ? (
          <span
            className="inline-flex size-3 cursor-help items-center justify-center rounded-full border border-line-2 text-[12px] text-ink-3"
            {...(typeof item.help === "string"
              ? { title: item.help, "aria-label": `說明:${item.help}` }
              : {})}
          >
            ?
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          /* min-w-0:grid 項目預設 min-width:auto,不加就撐破格子 —— 長文字會溢出到隔壁欄 */
          "flex min-h-[32px] min-w-0 items-center gap-1.5 border-cell bg-card text-[13px]",
          flush ? "" : "px-2.5 py-[5px]",
          borderB,
          isRowEnd ? "" : "border-r",
          item.mono && "font-mono tabular-nums",
        )}
      >
        {item.value}
        {item.note ? <span className="text-[12px] text-ink-3">{item.note}</span> : null}
      </div>
    </>
  )
}
