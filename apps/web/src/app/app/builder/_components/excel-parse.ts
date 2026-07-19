import { read, utils } from "xlsx"
import { normalizeColumnNames } from "./excel-import"

/* SheetJS 薄封裝(前端解析,原檔不上傳;OQ-GEI-3=A)。取首工作表:首列為欄名、其餘為資料。
   以 raw:false 取「格式化文字」(貨幣符號 / 日期字串保留),餵型別推斷 heuristic。 */

export const MAX_IMPORT_ROWS = 5000

export interface ParsedSheet {
  readonly sheetName: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
  readonly truncated: boolean
}

export function parseFirstSheet(data: ArrayBuffer): ParsedSheet {
  const wb = read(data, { type: "array" })
  const sheetName = wb.SheetNames[0]
  if (sheetName === undefined) throw new Error("活頁簿沒有工作表")
  const sheet = wb.Sheets[sheetName]
  if (sheet === undefined) throw new Error("讀不到工作表內容")

  const matrix = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  })

  const headerRow = matrix[0] ?? []
  const columns = normalizeColumnNames(headerRow.map((c) => String(c ?? "")))
  const width = columns.length

  const dataRows = matrix.slice(1)
  const truncated = dataRows.length > MAX_IMPORT_ROWS
  const rows = dataRows.slice(0, MAX_IMPORT_ROWS).map((row) => {
    const cells: string[] = []
    for (let i = 0; i < width; i++) cells.push(String(row[i] ?? ""))
    return cells
  })

  return { sheetName, columns, rows, truncated }
}

/* 逐欄抽值(給型別推斷取樣)*/
export function columnValues(rows: readonly (readonly string[])[], colIndex: number): string[] {
  return rows.map((r) => r[colIndex] ?? "")
}
