import { Suspense } from "react"
import { BuilderClient } from "./_components/builder-client"

// 依賴 runtime API + URL 查詢狀態(nuqs);不做靜態預渲染
export const dynamic = "force-dynamic"

export default function BuilderPage() {
  return (
    <Suspense fallback={null}>
      <BuilderClient />
    </Suspense>
  )
}
