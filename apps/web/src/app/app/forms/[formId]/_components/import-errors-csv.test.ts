import { describe, expect, it } from "vitest"
import { csvCell, errorsCsv } from "./import-errors-csv"

/* 🔴 錯誤列 CSV 的內容來自使用者上傳的檔案 —— 是不可信輸入。
   以 = + - @ 開頭的儲存格在 Excel 開啟時會被當公式執行(CSV injection)。 */
describe("錯誤列 CSV", () => {
  it("公式起手字元前綴單引號,不讓 Excel 當公式執行", () => {
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("\"'=cmd|'/c calc'!A1\"")
    expect(csvCell("+1")).toBe("\"'+1\"")
    expect(csvCell("-1")).toBe("\"'-1\"")
    expect(csvCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"")
  })

  it("一般值不加前綴,雙引號成對逸出", () => {
    expect(csvCell("客戶編號")).toBe('"客戶編號"')
    expect(csvCell('說"引號"')).toBe('"說""引號"""')
  })

  it("帶 BOM(否則 Excel 會把中文顯示成亂碼)且每列一行", () => {
    const csv = errorsCsv([
      { sourceRowNo: 3, errorCode: "NO_MATCH", errorMessage: "找不到對應的既有記錄" },
      { sourceRowNo: 7, errorCode: "KEY_EMPTY" },
    ])
    expect(csv.startsWith("﻿")).toBe(true)
    expect(csv.split("\n")).toHaveLength(3)
    expect(csv).toContain("找不到對應的既有記錄")
  })
})
