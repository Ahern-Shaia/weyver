"use client"

import { Button } from "@weyver/ui/button"
import { AlertTriangle } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { organization, useActiveOrganization } from "@/lib/auth/client"
import { EngineApiError, setTabOrgIntent } from "@/lib/engine/client"

/* 🔴 F-10|跨分頁租戶切換的使用者面。

   ## 問題

   「目前公司」原本存在伺服器端 session,**整個瀏覽器共用**。在分頁 2 切公司,
   分頁 1 就悄悄跟著換了 —— 然後在分頁 1 按儲存,資料進了另一家公司。

   ## 兩件事分開處理

   1. **後端已擋住寫入**(409 `TENANT_CONTEXT_MISMATCH`),所以不會真的寫錯
   2. 但使用者需要知道**為什麼被擋**,以及怎麼繼續

   ## ⚠️ 這段 UX 查無業界先例

   Shopify 對同一問題官方回覆是「無 workaround,請改架構」;
   沒有任何廠商公開描述「**未儲存變更 + 租戶被切換**」該怎麼處理。
   以下為自行設計,取捨寫明:

   - **不強制重載** —— 會直接丟掉使用者填到一半的內容
   - **不自動切回** —— 那等於替使用者做了他沒表達過的決定
   - 只掛橫幅告知,並在他真的要寫入時給兩個明確選項 */

const CHANNEL = "weyver.tenant"

export function TenantContextGuard({ children }: { readonly children: ReactNode }): ReactNode {
  const { data: activeOrg } = useActiveOrganization()
  /* 本分頁**首次** render 時鎖定的公司。之後不再更新 —— 它代表「這個分頁是哪一家的」。 */
  const [tabOrg, setTabOrg] = useState<{ id: string; name: string } | null>(null)
  const [switchedTo, setSwitchedTo] = useState<string | null>(null)

  useEffect(() => {
    if (tabOrg === null && activeOrg) {
      setTabOrg({ id: activeOrg.id, name: activeOrg.name })
      setTabOrgIntent(activeOrg.id)
    }
  }, [activeOrg, tabOrg])

  /* BroadcastChannel:同源、記憶體內、fire-and-forget(Clerk 也用它跨分頁廣播)。
     其他分頁切換公司時立刻知道,不必等到下一次請求被 409 才發現。 */
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<{ orgId: string; orgName: string }>) => {
      if (tabOrg !== null && event.data.orgId !== tabOrg.id) setSwitchedTo(event.data.orgName)
    }
    return () => channel.close()
  }, [tabOrg])

  if (tabOrg === null || switchedTo === null) return <>{children}</>

  return (
    <>
      {/* sticky 橫幅:告知但不打斷。使用者可能只是要把這頁看完。 */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-[11.5px] text-ink">
        <AlertTriangle size={13} className="shrink-0 text-warn" />
        <span className="min-w-0 flex-1">
          此分頁是<b>{tabOrg.name}</b>,但你在其他分頁已切換到<b>{switchedTo}</b>。
          這裡的存檔動作會先跟你確認,不會寫錯公司。
        </span>
        <Button
          size="sm"
          variant="default"
          onClick={() => {
            /* 「以本分頁的公司繼續」= 把作業公司切回這一家。
               其他分頁會收到廣播,換它們掛橫幅 —— 對稱處理,不偏袒任何一個分頁。 */
            void organization.setActive({ organizationId: tabOrg.id }).then(() => {
              setSwitchedTo(null)
            })
          }}
        >
          以{tabOrg.name}繼續
        </Button>
        <Button size="sm" variant="subtle" onClick={() => window.location.reload()}>
          改用{switchedTo}
        </Button>
      </div>
      {children}
    </>
  )
}

/* 切換公司時廣播給其他分頁。由切換器呼叫。 */
export function broadcastOrgSwitch(orgId: string, orgName: string): void {
  if (typeof BroadcastChannel === "undefined") return
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage({ orgId, orgName })
  channel.close()
}

/* 判斷一個錯誤是否為租戶不一致 —— 呼叫端據此顯示「要寫進哪一家」的確認。 */
export function isTenantMismatch(error: unknown): boolean {
  return error instanceof EngineApiError && error.code === "TENANT_CONTEXT_MISMATCH"
}
