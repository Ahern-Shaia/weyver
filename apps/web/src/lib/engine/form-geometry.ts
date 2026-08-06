import type { FieldDto, FieldLayout, Layout } from "./schemas"

/* 🔴 R1·UP-3c M1|**表單版面的唯一幾何來源**。

   ## 為什麼要抽出來

   form-designer-2d 的 D1 裁定是「2D 格線畫布 = 填單畫面本身」,但實作上兩邊各寫各的:
   設計畫布用 12 欄座標(col / row / colSpan),填單畫面用 `grid-cols-[136px_1fr]` 平鋪清單
   —— **設計時排的兩欄並排、欄寬,填單完全看不到**。使用者調了半天版面,填單長得一模一樣。

   兩份幾何 = 保證漂移。故座標常數與「有效版面」推導只留這一份,兩邊都吃它。

   ## 節距的來由

   COL_W 60:12 欄 × 60 = 720px,是 A4 直式可讀寬度(~700px)的量級,不是隨手取的整數。
   ROW_H 32:等於欄位格 min-h-[32px];設計與填單的列高同一個數字才叫「設計即所見」。 */

export const FORM_COLS = 12
export const FORM_COL_W = 60
export const FORM_ROW_H = 32
export const FORM_DEFAULT_SPAN = 6

export const EMPTY_LAYOUT: Layout = {
  grid: { cols: FORM_COLS },
  fields: {},
  statics: [],
  sections: [],
}

/* 沒有版面資料的欄位(剛加、或這張表從沒進過設計器)一律往下接一列、佔半寬。
   ⚠️ 設計器與填單必須用**同一個**推導,否則「還沒排版的欄位」兩邊位置不同。 */
export function effectiveLayout(fields: readonly FieldDto[], layout: Layout | null): Layout {
  const base = layout ?? EMPTY_LAYOUT
  const map: Record<string, FieldLayout> = { ...base.fields }
  let maxRow = Object.values(map).reduce((m, f) => Math.max(m, f.row), -1)
  for (const f of fields) {
    if (map[String(f.id)] === undefined) {
      maxRow += 1
      map[String(f.id)] = { row: maxRow, col: 0, colSpan: FORM_DEFAULT_SPAN }
    }
  }
  return { ...base, fields: map }
}

/* CSS grid 的定位樣式(1-based)。兩邊共用,避免一邊寫 col+1 另一邊忘了。 */
export function cellPosition(layout: Pick<FieldLayout, "col" | "row" | "colSpan">): {
  gridColumn: string
  gridRow: number
} {
  const span = layout.colSpan ?? FORM_DEFAULT_SPAN
  return { gridColumn: `${String(layout.col + 1)} / span ${String(span)}`, gridRow: layout.row + 1 }
}

/* 🔴 R1·後續-2b M2|列印角色也收進**同一份幾何**。

   列印設定面板(`print-settings.tsx`)存的是列號,而「哪一列是頁首」原本
   只有記錄頁自己解讀一份 —— 伺服器端 PDF 若再寫一份判斷,就是本 repo
   已經付過六次代價的「兩份鏡射必然漂移」。判斷只留這裡,兩邊都吃它。 */
export type PrintRole = "header" | "footer" | "body"

export function printRoleOf(layout: Layout | null, row: number): PrintRole {
  const print = layout?.print
  if (print === undefined) return "body"
  if (print.headerRows.includes(row)) return "header"
  if (print.footerRows.includes(row)) return "footer"
  return "body"
}

export function breaksAfter(layout: Layout | null, row: number): boolean {
  return layout?.print?.pageBreakAfterRows.includes(row) ?? false
}

/* 版面上實際用到的列號,由小到大。欄位與靜態元素都算 —— 只看欄位的話,
   一列若只放了說明文字就會從列印分組裡整個消失。 */
export function usedRows(layout: Layout): number[] {
  const rows = new Set<number>()
  for (const f of Object.values(layout.fields)) rows.add(f.row)
  for (const s of layout.statics) rows.add(s.row)
  return [...rows].sort((a, b) => a - b)
}
