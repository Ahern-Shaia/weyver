"use client"

import { Inbox } from "lucide-react"
import Link from "next/link"
import { type ReactNode, useState } from "react"
import { useForms, useMyPendingApprovals } from "@/lib/engine/hooks"

/* R1·後續-1 M3 我的待簽佇列(工作區首頁;承 workspace-ia 工作項目槽 OQ-WIA-5)。
   無待簽 → 不渲染(誠實:不佔位、不畫餅)。

   🔴 2026-08-01|**列前 6 筆,其餘給入口**。原本是 `pending.map` 全列 ——
   實測 109 筆待簽時整個首頁被這一個區塊吃掉,下方的「最近使用」與分類目錄
   使用者永遠捲不到。首頁的工作是**讓人看見全貌並選一件事做**,
   不是把其中一件事的完整清單攤在首頁。 */
const SHOWN = 6
export function PendingApprovals(): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const { data: pending = [] } = useMyPendingApprovals()
  const { data: forms } = useForms()

  if (pending.length === 0) return null
  const nameOf = (formId: number): string =>
    (forms ?? []).find((f) => f.id === formId)?.name ?? `表單 #${formId}`

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="flex items-center gap-1.5 text-[16px] font-semibold text-ink">
          <Inbox size={14} strokeWidth={1.9} className="text-warn" />
          待我簽核
        </h3>
        <span className="font-mono text-[12px] text-ink-3">{pending.length}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {(expanded ? pending : pending.slice(0, SHOWN)).map((p) => (
          <Link
            key={p.id}
            href={`/app/forms/${p.formId}?mode=record&rid=${p.recordId}`}
            className="flex items-center gap-2.5 rounded-sm border border-line bg-card px-3.5 py-2.5 transition-colors duration-fast-01 ease-productive-exit hover:border-primary hover:bg-primary-t"
          >
            <span className="text-[14px] font-medium text-ink">{nameOf(p.formId)}</span>
            <span className="font-mono text-[12px] text-ink-3">#{p.recordId}</span>
            <span className="ml-auto rounded-xs border border-warn-line bg-warn-t px-1.5 text-[12px] text-warn">
              第 {p.currentStep} 關
            </span>
          </Link>
        ))}
        {pending.length > SHOWN ? (
          /* ⚠️ 就地展開,**不連到 /app/approvals** —— 那個路由不存在。
             連到不存在的頁比不連更糟:使用者會以為自己按錯。 */
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-start px-1 py-0.5 text-[13px] text-link underline underline-offset-2"
          >
            {expanded ? "收合" : `另有 ${pending.length - SHOWN} 筆待簽`}
          </button>
        ) : null}
      </div>
    </section>
  )
}
