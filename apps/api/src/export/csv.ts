/* 🔴 R1·I-1|匯出用 CSV 序列化。

   ## 為什麼不能沿用 `hasSpreadsheetFormula()`

   既有那支是**偵測**:使用者上傳一份 CSV,我方檢查它是否以公式字元開頭,是就拒收。
   它刻意不改寫內容 —— 那是使用者的原始檔案,靜默改動會破壞資料。

   匯出的方向**完全相反**:檔案由**我方產生**,交給客戶用 Excel 開。
   同一份資料裡若有一格是 `=cmd|'/c calc'!A1`(它可能是使用者當初合法填進表單的文字),
   產出的 CSV 一被雙擊就觸發 DDE。此時正確的解法是 OWASP 對**輸出端**的建議:
   **前置一個單引號讓試算表當成文字**,而不是拒絕匯出自己的資料。

   照抄既有函式會做出錯的行為(該拒收的時候跳脫、該跳脫的時候拒收),故獨立一支。

   ## 逃脫規則

   1. 值以 `= + - @ Tab CR` 開頭 → 前置 `'`
   2. 含逗號 / 雙引號 / 換行 → 以雙引號包住,內部雙引號重複(RFC 4180)
   3. 兩者可同時發生 —— **順序是先加單引號再包雙引號**,反過來會把單引號留在引號外 */

const FORMULA_LEAD = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  const text = toText(value)
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replaceAll('"', '""')}"`
  return guarded
}

export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`
}

/* 值 → 文字。**陣列與物件走 JSON**(多選 / 附件 / lookup 快照)——
   `String([1,2])` 會得到 `1,2`,在 CSV 裡看起來像兩欄,是靜默的資料錯位。 */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/* 🔴 Excel 開 UTF-8 CSV 預設用系統編碼 → 中文全變亂碼。BOM 是唯一可靠的提示。
   客戶天天用 Excel,少了這三個位元組,「匯出的檔打不開」會變成第一名客訴。 */
export const UTF8_BOM = "﻿"
