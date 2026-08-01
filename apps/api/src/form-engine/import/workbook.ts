import { read, utils } from "xlsx"

/* 🔴 後端解析(OQ-IMP-6,推翻既有 OQ-GEI-3=A 的前端解析裁定)。

   **為什麼搬到後端**|Airtable CSV 擴充的 25,000 列 / 5MB 上限**正是前端解析的代價**;
   瀏覽器端會撞上 V8 的 `Cannot create a string longer than 0x1fffffe8 characters`。
   SheetJS 官方亦明言「當必須處理非常大的檔案時,考慮在伺服器端用 NodeJS 執行」。
   而本平台客戶要搬的是整份 Ragic 資料。

   **dense: true**|官方:「對於數十萬列的工作表應使用 dense 模式」。
   **cellDates: true**|日期取回 Date 物件而非依地區而異的字串,避開 `01/02/03` 的 MDY/DMY 歧義。

   ⚠️ 依賴取自 **SheetJS 官方 CDN tarball**,不是 npm registry 上的 `xlsx` ——
   後者停在 0.18.5 且帶 prototype pollution / ReDoS。前端已是此作法,後端沿用。 */

/* OQ-IMP-4 裁定。Airtable 25,000 / NetSuite 25,000 / Baserow 5,000 → 取兩倍以宣稱遷移優勢 */
export const MAX_IMPORT_ROWS = 50_000

export interface ParsedSheet {
  readonly sheetName: string
  readonly columns: readonly string[]
  readonly rows: readonly Record<string, string>[]
  readonly totalRows: number
  readonly truncated: boolean
  /** 標題列在原始檔的列號(1-based),供 UI 顯示「已略過前 N 列」 */
  readonly headerRowIndex: number
  /** 合併儲存格數量(已自動填滿);0 表示沒有 */
  readonly mergedCells: number
}

export class WorkbookError extends Error {}

/* 標題列偵測:實務上舊 Excel 前幾列常是公司抬頭或空行,寫死第一列會讓整份資料錯位。
   取「非空欄位最多、且不是整列數字」的那一列(整列數字多半已是資料)。 */
function detectHeaderRow(matrix: readonly (readonly unknown[])[]): number {
  const limit = Math.min(matrix.length, 20)
  let best = 0
  let bestFilled = -1
  for (let i = 0; i < limit; i++) {
    const cells = (matrix[i] ?? []).map((c) => String(c ?? "").trim())
    const filled = cells.filter((c) => c !== "").length
    if (filled === 0) continue
    if (cells.every((c) => c === "" || /^-?[\d.,]+$/.test(c))) continue
    if (filled > bestFilled) {
      bestFilled = filled
      best = i
    }
  }
  return best
}

/* 空 / 重複欄名正規化(空 → 欄N;重複 → 附序號),保順序 */
function normalizeColumnNames(raw: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((name, index) => {
    const base = name.trim() === "" ? `欄${index + 1}` : name.trim()
    const prior = seen.get(base) ?? 0
    seen.set(base, prior + 1)
    return prior === 0 ? base : `${base}_${prior + 1}`
  })
}

export function sheetNames(buffer: Buffer): string[] {
  const wb = read(buffer, { type: "buffer", dense: true, bookSheets: true })
  if (wb.SheetNames.length === 0) throw new WorkbookError("活頁簿沒有工作表")
  return wb.SheetNames
}

/* 🔴 預設工作表取**資料列最多的那張**,不是第一張(瀏覽器實走時發現)。
   客戶的舊 Excel 常把「使用說明 / 範本」放在前面 —— 取第一張會讓使用者
   一上傳就看到「共 0 列」,以為軟體壞了。選擇器仍在,使用者可覆寫。 */
function pickDefaultSheet(wb: ReturnType<typeof read>): string | undefined {
  let best: string | undefined
  let bestRows = -1
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    if (sheet === undefined) continue
    const rows = utils
      .sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" })
      .filter((row) => row.some((c) => String(c ?? "").trim() !== "")).length
    if (rows > bestRows) {
      bestRows = rows
      best = name
    }
  }
  return best
}

export function parseSheet(buffer: Buffer, wanted?: string): ParsedSheet {
  const wb = read(buffer, { type: "buffer", dense: true, cellDates: true })
  const name = wanted ?? pickDefaultSheet(wb)
  if (name === undefined) throw new WorkbookError("活頁簿沒有工作表")
  const sheet = wb.Sheets[name]
  if (sheet === undefined) throw new WorkbookError(`找不到工作表「${name}」`)

  /* blankrows:false 會在偵測標題列**之前**就改變列號,使回報的列號對不回原檔 */
  const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" })
  /* 🔴 合併儲存格:值只存在左上角,其餘格子是空的 —— 直接匯入會靜默產生空白欄位。
     舊 Excel 的單頭欄(訂單編號跨多列明細)幾乎必然是合併的。
     以左上角的值填滿整個範圍 = 使用者看到的內容,並回報數量讓 UI 說清楚做了什麼。 */
  const mergedCells = fillMerges(matrix, sheet["!merges"])
  const headerIndex = detectHeaderRow(matrix)
  const columns = normalizeColumnNames((matrix[headerIndex] ?? []).map((c) => String(c ?? "")))

  const dataRows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((c) => String(c ?? "").trim() !== ""))
  const truncated = dataRows.length > MAX_IMPORT_ROWS
  const rows = dataRows.slice(0, MAX_IMPORT_ROWS).map((row) => {
    const out: Record<string, string> = {}
    for (const [i, column] of columns.entries()) out[column] = String(row[i] ?? "")
    return out
  })

  return {
    sheetName: name,
    columns,
    rows,
    totalRows: dataRows.length,
    truncated,
    headerRowIndex: headerIndex + 1,
    mergedCells,
  }
}

/* 以合併範圍左上角的值填滿該範圍。回傳被填的儲存格數(不含左上角本身)。 */
function fillMerges(
  matrix: unknown[][],
  merges: readonly { s: { r: number; c: number }; e: { r: number; c: number } }[] | undefined,
): number {
  if (merges === undefined || merges.length === 0) return 0
  let filled = 0
  for (const range of merges) {
    const anchor = matrix[range.s.r]?.[range.s.c]
    if (anchor === undefined || String(anchor) === "") continue
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = matrix[r]
      if (row === undefined) continue
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (r === range.s.r && c === range.s.c) continue
        row[c] = anchor
        filled += 1
      }
    }
  }
  return filled
}

/* 欄名 → 表單欄位的建議對映。
   **只做完全相符(去空白、不分大小寫)** —— 模糊比對只該當建議不該自動套:
   誤配比未配更貴(使用者不會發現「客戶編號」被配到「客戶電話」上)。 */
export function suggestMapping(
  columns: readonly string[],
  fieldNames: readonly string[],
): Record<string, string> {
  const byKey = new Map(fieldNames.map((f) => [f.trim().toLowerCase(), f]))
  const out: Record<string, string> = {}
  const used = new Set<string>()
  for (const column of columns) {
    const hit = byKey.get(column.trim().toLowerCase())
    if (hit === undefined || used.has(hit)) continue
    out[column] = hit
    used.add(hit)
  }
  return out
}
