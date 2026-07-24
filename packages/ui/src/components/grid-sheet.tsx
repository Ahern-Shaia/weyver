"use client"

import {
  DataEditor,
  type EditableGridCell,
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
