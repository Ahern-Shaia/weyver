"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/* R1·UX-1 M5|W3C ARIA APG grid pattern。**照抄,不自創。**

   規範:https://www.w3.org/WAI/ARIA/apg/patterns/grid/
   - 方向鍵移動,**邊界不環繞**
   - `Home`/`End` = 該列首 / 末格;`Ctrl+Home`/`Ctrl+End` = 全表首 / 末格
   - `Enter` 或 `F2` 進編輯;輸入英數直接進編輯;`Esc` 回導覽態
   - **roving tabindex:整個 grid 只有一個 Tab 停點**

   ## 為什麼是「導覽態 / 編輯態」兩態

   現況每格恆為 input,方向鍵在輸入框內只移動游標,且**不小心打字就改到資料**。
   兩態分離讓導覽時的按鍵不落進輸入框 —— 這與 Excel 一致(`F2` 切換),
   而目標使用者正是 Excel 與 Ragic 的重度使用者。

   ## 🔴 FMEA U4(P0):不得造成鍵盤陷阱

   `Tab` **一律不攔截** —— 導覽態按 Tab 離開整個 grid,編輯態按 Tab 亦不攔。
   攔了就是 WCAG 2.1.1 的鍵盤陷阱(A 級違規),比「要多按幾次 Tab」嚴重得多。 */

const FOCUSABLE = "input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])"

export interface GridPos {
  readonly row: number
  readonly col: number
}

export interface GridKeyboard {
  readonly pos: GridPos
  readonly editing: boolean
  /* 綁在每個資料 `<td>` 上 */
  cellProps: (row: number, col: number) => {
    tabIndex: number
    onFocus: () => void
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
    "data-grid-cell": string
  }
  containerRef: React.RefObject<HTMLElement | null>
}

export function useGridKeyboard(rows: number, cols: number): GridKeyboard {
  const [pos, setPos] = useState<GridPos>({ row: 0, col: 0 })
  const [editing, setEditing] = useState(false)
  const containerRef = useRef<HTMLElement | null>(null)

  const cellAt = useCallback((row: number, col: number): HTMLElement | null => {
    return containerRef.current?.querySelector<HTMLElement>(`[data-grid-cell="${row}:${col}"]`) ?? null
  }, [])

  /* 導覽態:格內所有可聚焦元素退出 Tab 序列,使整個 grid 只剩一個停點。
     編輯態:只有當前格恢復,讓輸入元件正常運作。 */
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    for (const cell of root.querySelectorAll<HTMLElement>("[data-grid-cell]")) {
      const isCurrent = cell.dataset["gridCell"] === `${String(pos.row)}:${String(pos.col)}`
      const active = editing && isCurrent
      for (const el of cell.querySelectorAll<HTMLElement>(FOCUSABLE)) {
        el.tabIndex = active ? 0 : -1
      }
    }
  }, [pos, editing, rows, cols])

  const move = useCallback(
    (row: number, col: number) => {
      /* 🔴 邊界不環繞(APG 明訂) */
      const r = Math.max(0, Math.min(rows - 1, row))
      const c = Math.max(0, Math.min(cols - 1, col))
      setPos({ row: r, col: c })
      setEditing(false)
      cellAt(r, c)?.focus()
    },
    [rows, cols, cellAt],
  )

  const beginEdit = useCallback(
    (row: number, col: number, seed?: string) => {
      setEditing(true)
      /* 等 effect 把 tabIndex 放回去,再把焦點交給輸入元件 */
      queueMicrotask(() => {
        const first = cellAt(row, col)?.querySelector<HTMLElement>(FOCUSABLE)
        if (!first) return
        first.focus()
        if (seed !== undefined && first instanceof HTMLInputElement) {
          /* 直接打字進編輯 → 取代原值(Excel / APG 行為) */
          first.value = seed
          first.dispatchEvent(new Event("input", { bubbles: true }))
        } else if (first instanceof HTMLInputElement) {
          first.select()
        }
      })
    },
    [cellAt],
  )

  const onKeyDown = useCallback(
    (row: number, col: number) =>
      (e: React.KeyboardEvent<HTMLElement>): void => {
        /* 🔴 Tab 一律放行 —— 不製造鍵盤陷阱(FMEA U4) */
        if (e.key === "Tab") return

        if (editing) {
          if (e.key === "Escape" || e.key === "F2") {
            e.preventDefault()
            e.stopPropagation()
            setEditing(false)
            cellAt(row, col)?.focus()
          } else if (e.key === "Enter") {
            /* Enter 收工並往下一列 —— 連續輸入時最順的方向 */
            e.preventDefault()
            e.stopPropagation()
            move(row + 1, col)
          }
          return
        }

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault()
            move(row + 1, col)
            break
          case "ArrowUp":
            e.preventDefault()
            move(row - 1, col)
            break
          case "ArrowRight":
            e.preventDefault()
            move(row, col + 1)
            break
          case "ArrowLeft":
            e.preventDefault()
            move(row, col - 1)
            break
          case "Home":
            e.preventDefault()
            move(e.ctrlKey || e.metaKey ? 0 : row, 0)
            break
          case "End":
            e.preventDefault()
            move(e.ctrlKey || e.metaKey ? rows - 1 : row, cols - 1)
            break
          case "Enter":
          case "F2":
            e.preventDefault()
            beginEdit(row, col)
            break
          default:
            /* 可列印字元直接進編輯並取代內容;組合鍵不算 */
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault()
              beginEdit(row, col, e.key)
            }
        }
      },
    [editing, rows, cols, move, beginEdit, cellAt],
  )

  const cellProps = useCallback(
    (row: number, col: number) => ({
      tabIndex: pos.row === row && pos.col === col ? 0 : -1,
      onFocus: () => {
        if (pos.row !== row || pos.col !== col) setPos({ row, col })
      },
      onKeyDown: onKeyDown(row, col),
      "data-grid-cell": `${String(row)}:${String(col)}`,
    }),
    [pos, onKeyDown],
  )

  return { pos, editing, cellProps, containerRef }
}
