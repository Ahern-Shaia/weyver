"use client"

import { useActiveOrganization } from "@/lib/auth/client"
import { getDevTenant } from "@/lib/engine/client"

/* R1·UX-1 M4|本地儲存用的租戶識別。

   prod 以 active org id 為準;dev 未登入時退回 `x-dev-tenant`(與送給後端的同一個值),
   否則 dev 下所有租戶會共用同一個 key。寫入端與讀取端必須用**同一個函式**算 scope ——
   兩邊各算一次是這類 bug 的來源。 */
export function useTenantScope(): string {
  const { data: activeOrg } = useActiveOrganization()
  return activeOrg?.id ?? `dev:${getDevTenant()}`
}
