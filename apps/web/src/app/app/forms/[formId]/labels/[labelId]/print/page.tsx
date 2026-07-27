import { Suspense } from "react"
import { LabelPrintClient } from "./_client"

// 依賴 runtime API + URL 查詢狀態;不做靜態預渲染
export const dynamic = "force-dynamic"

export default function LabelPrintPage() {
  return (
    <Suspense fallback={null}>
      <LabelPrintClient />
    </Suspense>
  )
}
