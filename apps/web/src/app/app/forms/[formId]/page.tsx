import { Suspense } from "react"
import { FormWorkspace } from "./_components/form-workspace"

// 依賴 runtime API + URL 查詢狀態(nuqs mode/rid);不做靜態預渲染
export const dynamic = "force-dynamic"

export default function FormPage() {
  return (
    <Suspense fallback={null}>
      <FormWorkspace />
    </Suspense>
  )
}
