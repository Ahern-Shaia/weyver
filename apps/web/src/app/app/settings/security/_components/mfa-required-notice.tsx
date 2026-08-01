"use client"

import { ShieldAlert } from "lucide-react"
import { useSearchParams } from "next/navigation"
import type { ReactNode } from "react"

/* 🔴 被公司政策擋下來的人,落在這一頁時必須看得懂發生了什麼事。

   後端對每一支 API 回 `MFA_REQUIRED`,前端統一導到這裡(client.ts)。
   少了這條說明,使用者看到的是「我明明有帳號,為什麼什麼都打不開」——
   而這一頁其他區塊看起來一切正常,更難聯想到是政策造成的。

   GitHub 的措辭同樣是把後果講在前面:未啟用者無法存取組織資源,**直到**啟用為止。 */

export function MfaRequiredNotice(): ReactNode {
  const params = useSearchParams()
  if (params.get("mfa") !== "required") return null

  return (
    <div className="flex items-start gap-2 rounded-sm border border-er/40 bg-er/5 p-3">
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-er" />
      <p className="text-[12px] text-ink-2">
        <b className="text-ink">公司已要求二步驟驗證。</b>
        在你完成下方的啟用之前,無法使用公司資料。啟用後即可繼續原本的工作。
      </p>
    </div>
  )
}
