import type { FieldDto } from "./schemas"

/* 🔴 條碼型式的判斷從 `barcode.tsx` 抽出來 —— 那一檔是 `"use client"`,
   而伺服器元件(列印頁 `print/[ticket]/_document.tsx`)呼叫不到住在客戶端檔案裡的
   普通函式(Next 會丟「Attempted to call fieldSymbology() from the server」)。

   `BarcodeView` 本身留在客戶端檔案:伺服器元件**渲染**客戶端元件是允許的,
   不允許的只是**呼叫**它匯出的函式。 */
export function fieldSymbology(field: FieldDto): "qr" | "code128" | null {
  if (field.type === "barcode") {
    const s = (field.options as { symbology?: string }).symbology
    return s === "code128" ? "code128" : "qr"
  }
  // Ragic doc/53「以條碼顯示」語意:text 欄可設 QR 呈現(QR-only)
  if ((field.options as { showAsQr?: boolean }).showAsQr === true) return "qr"
  return null
}
