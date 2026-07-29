import { read, utils } from "xlsx"
import { normalizeColumnNames } from "./excel-import"

/* SheetJS 薄封裝(前端解析,原檔不上傳;OQ-GEI-3=A)。
   以 raw:false 取「格式化文字」(貨幣符號 / 日期字串保留),餵型別推斷 heuristic。 */

export const MAX_IMPORT_ROWS = 5000

export interface ParsedSheet {
  readonly sheetName: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
  readonly truncated: boolean
  /** 標題列在原始檔的列號(1-based),供 UI 顯示「已略過前 N 列」 */
  readonly headerRowIndex: number
}

export interface Workbook {
  readonly sheetNames: readonly string[]
  readonly data: ArrayBuffer
}

/* 🔴 原本寫死 `SheetNames[0]`(#106):客戶的舊 Excel 常有「說明」「範本」等前置工作表,
   靜默吃錯表 —— 匯進來的是一堆說明文字,而使用者只會覺得「這軟體壞了」。改為讓使用者選。 */
export function readWorkbook(data: ArrayBuffer): Workbook {
  const wb = read(data, { type: "array", dense: true })
  if (wb.SheetNames.length === 0) throw new Error("活頁簿沒有工作表")
  return { sheetNames: wb.SheetNames, data }
}

/* 🔴 原本寫死 `matrix[0]` 當標題列(#106):實務上舊 Excel 的前幾列常是標題、公司抬頭或空行。
   改為找出**第一列看起來像標題的**:非空欄位最多、且該列的值都不像純數字
   (標題是文字;若整列都是數字,那多半已經是資料列)。找不到就退回第 0 列。 */
function detectHeaderRow(matrix: readonly (readonly unknown[])[]): number {
  const limit = Math.min(matrix.length, 20)
  let best = 0
  let bestFilled = -1
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] ?? []
    const cells = row.map((c) => String(c ?? "").trim())
    const filled = cells.filter((c) => c !== "").length
    if (filled === 0) continue
    const allNumeric = cells.every((c) => c === "" || /^-?[\d.,]+$/.test(c))
    if (allNumeric) continue
    if (filled > bestFilled) {
      bestFilled = filled
      best = i
    }
  }
  return best
}

export function parseSheet(data: ArrayBuffer, sheetName?: string): ParsedSheet {
  const wb = read(data, { type: "array", dense: true })
  const name = sheetName ?? wb.SheetNames[0]
  if (name === undefined) throw new Error("活頁簿沒有工作表")
  const sheet = wb.Sheets[name]
  if (sheet === undefined) throw new Error("讀不到工作表內容")

  /* blankrows:false 會**在偵測標題列之前就改變列號**,使 headerRowIndex 對不回原檔;
     故保留空列,由 detectHeaderRow 自行略過。 */
  const matrix = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  })

  const headerIndex = detectHeaderRow(matrix)
  const headerRow = matrix[headerIndex] ?? []
  const columns = normalizeColumnNames(headerRow.map((c) => String(c ?? "")))
  const width = columns.length

  const dataRows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((c) => String(c ?? "").trim() !== ""))
  const truncated = dataRows.length > MAX_IMPORT_ROWS
  const rows = dataRows.slice(0, MAX_IMPORT_ROWS).map((row) => {
    const cells: string[] = []
    for (let i = 0; i < width; i++) cells.push(String(row[i] ?? ""))
    return cells
  })

  return { sheetName: name, columns, rows, truncated, headerRowIndex: headerIndex + 1 }
}

/* 逐欄抽值(給型別推斷取樣)*/
export function columnValues(rows: readonly (readonly string[])[], colIndex: number): string[] {
  return rows.map((r) => r[colIndex] ?? "")
}
