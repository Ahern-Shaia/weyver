/* 匯入錯誤列下載(#106)。只顯示前 5 列等於叫使用者自己猜其餘幾百列是哪些;
   要修檔案就得拿到全部,這是 Excel 遷移的實際工作方式。 */

export interface ErrorRow {
  readonly sourceRowNo: number
  readonly errorCode?: string | undefined
  readonly errorMessage?: string | undefined
}

/* 🔴 CSV 注入:以 = + - @ 開頭的儲存格在 Excel 開啟時會被當公式執行。
   錯誤訊息裡含使用者檔案的原始內容,必須當成不可信輸入。前綴單引號為 OWASP 標準緩解。 */
export function csvCell(value: string): string {
  const escaped = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${escaped.replace(/"/g, '""')}"`
}

export function errorsCsv(rows: readonly ErrorRow[]): string {
  const header = ["原始列號", "錯誤代碼", "錯誤說明"].map(csvCell).join(",")
  const body = rows
    .map((r) =>
      [String(r.sourceRowNo), r.errorCode ?? "", r.errorMessage ?? ""].map(csvCell).join(","),
    )
    .join("\n")
  // BOM:Excel 沒有它會把 UTF-8 中文顯示成亂碼
  return `﻿${header}\n${body}`
}

export function downloadErrorsCsv(rows: readonly ErrorRow[]): void {
  const blob = new Blob([errorsCsv(rows)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "import-errors.csv"
  a.click()
  URL.revokeObjectURL(url)
}
