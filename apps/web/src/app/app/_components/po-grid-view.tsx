"use client"

import {
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type Item,
} from "@glideapps/glide-data-grid"
import { GridSheet } from "@weyver/ui/grid-sheet"
import { useCallback, useMemo, useState } from "react"
import { PO_LINES, type PoLine, fmt } from "./po-data"

/* S2 網格編輯器(Glide canvas):數量/單價可編輯 → 小計 fx 即時重算(「算」織入網格) */
const COLUMNS: readonly GridColumn[] = [
  { id: "item", title: "品項", width: 200 },
  { id: "spec", title: "規格", width: 140 },
  { id: "qty", title: "數量", width: 90 },
  { id: "price", title: "單價", width: 110 },
  { id: "subtotal", title: "小計 fx", width: 120 },
]

export function PoGridView() {
  const [lines, setLines] = useState<PoLine[]>(() => PO_LINES.map((line) => ({ ...line })))

  const total = useMemo(() => lines.reduce((sum, line) => sum + line.qty * line.price, 0), [lines])

  /* 公式欄樣式讀語意 token(禁硬編 hex) */
  const fxTheme = useMemo(() => {
    if (typeof window === "undefined") return {}
    const styles = getComputedStyle(document.documentElement)
    return {
      bgCell: styles.getPropertyValue("--color-fx-bg").trim(),
      textDark: styles.getPropertyValue("--color-fx").trim(),
    }
  }, [])

  const getCell = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell
      const line = lines[row]
      if (!line) {
        return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false }
      }
      const column = COLUMNS[col]
      switch (column?.id) {
        case "item":
          return {
            kind: GridCellKind.Text,
            data: line.item,
            displayData: line.item,
            allowOverlay: true,
          }
        case "spec":
          return {
            kind: GridCellKind.Text,
            data: line.spec,
            displayData: line.spec,
            allowOverlay: true,
          }
        case "qty":
          return {
            kind: GridCellKind.Number,
            data: line.qty,
            displayData: fmt(line.qty),
            allowOverlay: true,
            contentAlign: "right",
          }
        case "price":
          return {
            kind: GridCellKind.Number,
            data: line.price,
            displayData: fmt(line.price),
            allowOverlay: true,
            contentAlign: "right",
          }
        case "subtotal":
          return {
            kind: GridCellKind.Number,
            data: line.qty * line.price,
            displayData: fmt(line.qty * line.price),
            allowOverlay: false,
            contentAlign: "right",
            themeOverride: fxTheme,
          }
        default:
          return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false }
      }
    },
    [lines, fxTheme],
  )

  const onCellEdited = useCallback((cell: Item, newValue: EditableGridCell) => {
    const [col, row] = cell
    const column = COLUMNS[col]
    setLines((previous) => {
      const next = previous.map((line) => ({ ...line }))
      const line = next[row]
      if (!line || !column) return previous
      if (newValue.kind === GridCellKind.Text) {
        if (column.id === "item") line.item = newValue.data
        if (column.id === "spec") line.spec = newValue.data
      }
      if (newValue.kind === GridCellKind.Number) {
        const value = newValue.data ?? 0
        if (column.id === "qty") line.qty = value
        if (column.id === "price") line.price = value
      }
      return next
    })
  }, [])

  return (
    <div className="p-3.5">
      <div className="border border-line">
        <GridSheet
          columns={COLUMNS}
          rowCount={lines.length}
          getCell={getCell}
          onCellEdited={onCellEdited}
          height={320}
        />
        <div className="flex items-center justify-between border-t-2 border-t-fx bg-fx-bg px-3 py-1.5 text-[12px] font-semibold text-fx">
          <span>
            總計<span className="font-normal opacity-75">(fx = Σ 數量 × 單價,編輯即重算)</span>
          </span>
          <span className="font-mono tabular-nums">NT$ {fmt(total)}</span>
        </div>
      </div>
      <p className="mt-1.5 text-[10.5px] text-ink-4">
        Glide Data Grid(canvas)· 雙擊儲存格編輯 數量 / 單價 → 小計與總計即時重算 · 公式欄唯讀(fx
        底色)
      </p>
    </div>
  )
}
