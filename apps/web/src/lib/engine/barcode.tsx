"use client"

import { QRCodeSVG } from "qrcode.react"
import type { ReactNode } from "react"

/* R1·後續-2 M2 條碼顯示(OQ-PM-4=A:P0 僅 QR,複用已裝之 qrcode.react;SVG 對列印友善)。
   Code128 需新依賴 → P1,明示提示不靜默空白(誠實)。

   ⚠️ `fieldSymbology` 已移到 `symbology.ts`(非 client)—— 伺服器元件呼叫不到
   住在 `"use client"` 檔裡的普通函式。 */

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
  if (text === "") return <span className="text-[12px] text-ink-3">—</span>
  if (symbology === "code128") {
    return (
      <span className="inline-flex items-center gap-1 rounded-xs border border-line bg-label px-1.5 py-0.5 text-[12px] text-ink-3">
        Code128 待後續版本;現值 <span className="font-mono text-ink-3">{text}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <QRCodeSVG value={text} size={size} level="M" marginSize={0} />
      <span className="font-mono text-[12px] text-ink-3">{text}</span>
    </span>
  )
}
