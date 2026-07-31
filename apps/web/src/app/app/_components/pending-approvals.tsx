"use client"

import { Inbox } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { useForms, useMyPendingApprovals } from "@/lib/engine/hooks"

/* R1·後續-1 M3 我的待簽佇列(工作區首頁;承 workspace-ia 工作項目槽 OQ-WIA-5)。
   無待簽 → 不渲染(誠實:不佔位、不畫餅)。 */
export function PendingApprovals(): ReactNode {
  const { data: pending = [] } = useMyPendingApprovals()
  const { data: forms } = useForms()

  if (pending.length === 0) return null
  const nameOf = (formId: number): string =>
    (forms ?? []).find((f) => f.id === formId)?.name ?? `表單 #${formId}`

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
          <Inbox size={14} strokeWidth={1.9} className="text-warn" />
          待我簽核
        </h3>
        <span className="font-mono text-[12px] text-ink-3">{pending.length}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {pending.map((p) => (
          <Link
            key={p.id}
            href={`/app/forms/${p.formId}?mode=record&rid=${p.recordId}`}
            className="flex items-center gap-2 rounded-sm border border-line bg-card px-3 py-2 transition-colors duration-fast-01 ease-productive-exit hover:border-primary hover:bg-primary-t"
          >
            <span className="text-[12px] font-medium text-ink">{nameOf(p.formId)}</span>
            <span className="font-mono text-[12px] text-ink-3">#{p.recordId}</span>
            <span className="ml-auto rounded-xs border border-warn-line bg-warn-t px-1.5 text-[12px] text-warn">
              第 {p.currentStep} 關
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
