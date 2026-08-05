"use client"

import {
  DataEditor,
  type EditableGridCell,
  type EditListItem,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Rectangle,
  type Theme,
} from "@glideapps/glide-data-grid"
import "@glideapps/glide-data-grid/dist/index.css"
import { useEffect, useMemo, useState } from "react"
import type { ReactElement } from "react"

/* docs/14 v2 §1.2|S2 網格編輯器:Glide Data Grid(canvas)封裝,theme 由語意 token 讀出(禁硬編 hex) */
export interface GridSheetProps {
  readonly columns: readonly GridColumn[]
  readonly rowCount: number
  readonly getCell: (cell: Item) => GridCell
  readonly onCellEdited?: (cell: Item, newValue: EditableGridCell) => void
  /* Glide 原型是 `boolean | void`,此處收窄成 `boolean`:回 `true` 表示「這批我自己處理了,
     grid 不要再套用預設寫入」。留 `void` 會讓呼叫端漏寫 return 而默默走進預設行為。 */
  readonly onCellsEdited?: (edits: readonly EditListItem[]) => boolean
  /* 🔴 回傳 `true` 以外的任何值都會讓 Glide 整批放棄(它比對的是 `!== true`)。
     貼上要做先驗 / 加列 / 計算欄跳過,都必須由我們接管 → 一律回 `false`,
     這也是套件型別註解自己建議的:「advisable to simply return false from onPaste
     and handle the paste manually」。回 `true` 則 Glide 自己寫格,
     且**超出列數的部分會靜默丟掉**(`if (row + targetRow >= rows) break`)。 */
  readonly onPaste?: ((target: Item, values: readonly (readonly string[])[]) => boolean) | boolean
  readonly onCellClicked?: (cell: Item) => void
  /* 🔴 凍結欄數(從左邊算起)。Ragic 官方 `doc/107` 逐字:「設定您凍結**欄或列的數量**
     (欄是從左邊算起)……**列表頁只能設定凍結欄**」—— 語意是數量不是選欄,
     與 Glide 的 `freezeColumns: number` 同構,故不自己包一層。 */
  readonly freezeColumns?: number
  /* 🔴 填滿把手。`fillHandle` 開啟拖曳點,`onFillPattern` 給 patternSource 與
     fillDestination 兩個區域且**可以 prevent** —— 我方一律 prevent 並自己套用,
     因為填充必須走與貼上同一條寫入路徑(計算欄跳過 / 型別先驗)。
     兩者都給才有意義:只開 `fillHandle` 而不接事件,拖了會走 Glide 的預設寫入。 */
  readonly onFillPattern?: (source: Rectangle, destination: Rectangle) => void
  readonly rowMarkers?: "number" | "checkbox" | "both" | "none"
  readonly gridSelection?: GridSelection
  readonly onGridSelectionChange?: (selection: GridSelection) => void
  readonly height?: number | string
  readonly className?: string
}

function readToken(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim()
}

export function GridSheet({
  columns,
  rowCount,
  getCell,
  onCellEdited,
  onCellsEdited,
  onPaste,
  onCellClicked,
  freezeColumns = 0,
  onFillPattern,
  rowMarkers = "number",
  gridSelection,
  onGridSelectionChange,
  height = 420,
  className,
}: GridSheetProps): ReactElement {
  /* Glide 依賴 canvas/DOM,首次 SSR 以佔位替代,mount 後才渲染 */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const theme = useMemo<Partial<Theme>>(() => {
    if (!mounted) return {}
    const styles = getComputedStyle(document.documentElement)
    return {
      accentColor: readToken(styles, "--color-primary"),
      accentLight: readToken(styles, "--color-primary-t"),
      textDark: readToken(styles, "--color-ink"),
      textMedium: readToken(styles, "--color-ink-2"),
      textLight: readToken(styles, "--color-ink-3"),
      textHeader: readToken(styles, "--color-ink-2"),
      bgHeader: readToken(styles, "--color-head"),
      bgHeaderHovered: readToken(styles, "--color-label"),
      bgHeaderHasFocus: readToken(styles, "--color-label"),
      bgCell: readToken(styles, "--color-card"),
      borderColor: readToken(styles, "--color-cell"),
      horizontalBorderColor: readToken(styles, "--color-cell"),
      fontFamily: readToken(styles, "--font-sans"),
      headerFontStyle: "600 11px",
      baseFontStyle: "12px",
      editorFontSize: "12px",
      cellVerticalPadding: 4,
      cellHorizontalPadding: 8,
    }
  }, [mounted])

  if (!mounted) {
    return <div style={{ height }} className="border border-line bg-card" />
  }

  return (
    <div style={{ height }} className={className}>
      <DataEditor
        columns={[...columns]}
        rows={rowCount}
        getCellContent={getCell}
        {...(onCellEdited ? { onCellEdited } : {})}
        {...(onCellsEdited ? { onCellsEdited } : {})}
        {...(onPaste === undefined ? {} : { onPaste })}
        {...(onCellClicked ? { onCellClicked } : {})}
        freezeColumns={freezeColumns}
        fillHandle={onFillPattern !== undefined}
        {...(onFillPattern
          ? {
              onFillPattern: (e: {
                patternSource: Rectangle
                fillDestination: Rectangle
                preventDefault: () => void
              }) => {
                /* 一律接管:Glide 的預設寫入不認識計算欄與型別驗證 */
                e.preventDefault()
                onFillPattern(e.patternSource, e.fillDestination)
              },
            }
          : {})}
        {...(gridSelection ? { gridSelection } : {})}
        {...(onGridSelectionChange ? { onGridSelectionChange } : {})}
        theme={theme}
        width="100%"
        height="100%"
        rowMarkers={rowMarkers}
        smoothScrollX
        smoothScrollY
        getCellsForSelection
      />
    </div>
  )
}
