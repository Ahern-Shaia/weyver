"use client"

import {
  DataEditor,
  type EditableGridCell,
  type EditListItem,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
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
