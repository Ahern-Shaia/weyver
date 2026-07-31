"use client"

import { QRCodeSVG } from "qrcode.react"
import type { ReactNode } from "react"
import type { FieldDto } from "./schemas"

/* R1·後續-2 M2 條碼顯示(OQ-PM-4=A:P0 僅 QR,複用已裝之 qrcode.react;SVG 對列印友善)。
   Code128 需新依賴 → P1,明示提示不靜默空白(誠實)。 */

export function fieldSymbology(field: FieldDto): "qr" | "code128" | null {
  if (field.type === "barcode") {
    const s = (field.options as { symbology?: string }).symbology
    return s === "code128" ? "code128" : "qr"
  }
  // Ragic doc/53「以條碼顯示」語意:text 欄可設 QR 呈現(QR-only)
  if ((field.options as { showAsQr?: boolean }).showAsQr === true) return "qr"
  return null
}

export function BarcodeView({
  value,
  symbology = "qr",
  size = 72,
}: {
  readonly value: unknown
  readonly symbology?: "qr" | "code128"
  readonly size?: number
}): ReactNode {
  const text = value === null || value === undefined ? "" : String(value)
  if (text === "") return <span className="text-[11px] text-ink-3">—</span>
  if (symbology === "code128") {
    return (
      <span className="inline-flex items-center gap-1 rounded-xs border border-line bg-label px-1.5 py-0.5 text-[10px] text-ink-3">
        Code128 待後續版本;現值 <span className="font-mono text-ink-3">{text}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <QRCodeSVG value={text} size={size} level="M" marginSize={0} />
      <span className="font-mono text-[9.5px] text-ink-3">{text}</span>
    </span>
  )
}
