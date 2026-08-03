"use client"

import { Button } from "@weyver/ui/button"
import { Inbox, Share2 } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import {
  useForms,
  usePublicShares,
  useReviewSubmission,
  useShareToggle,
  useSubmissionInbox,
} from "@/lib/engine/hooks"
import { BusyBar } from "@/components/busy-indicator"

/* G-2 M4|公開表單的**租戶級**那一半:跨表單總覽 + 待審收件匣。

   🔴 **R1·IA 第二階段(2026-08-04)**:建立分享(選表單 + 挑欄位)已搬到表單層。
   `docs/33 §2.1` 抱怨的正是這裡原本的「選擇表單」下拉 ——
   使用者人在表單上想公開這張表,卻要離開表單、進設定、**再把同一張表選一次**。

   留在這裡的是**只有跨表單視角才做得到的事**:一次看到「我們對外開了哪些口」
   (資安面),以及一個不分表單的待審佇列(工作佇列)。
   關閉 / 重新開放留著 —— 那是租戶級的緊急控制,且與表單層寫的是同一列,
   不存在「改哪個才算數」的歧義。

   **收件匣不是可有可無的中繼站,是刻意的隔離** —— 匿名提交在被人看過之前
   不會進系統、不吃單號、不觸發簽核。UI 用「待審」而非「新資料」措辭。 */

export default function PublicFormsPage(): ReactNode {
  const { data: forms } = useForms()
  const { data: shares, isLoading } = usePublicShares()
  const { data: inbox } = useSubmissionInbox()
  const toggle = useShareToggle()
  const review = useReviewSubmission()

  const nameOf = (formId: number): string =>
    (forms ?? []).find((f) => f.id === formId)?.name ?? `表單 #${String(formId)}`

  return (
    <div className="relative mx-auto max-w-[820px] p-6">
      <BusyBar busy={isLoading} />
      <h2 className="text-[16px] font-semibold">公開表單</h2>
      <p className="mt-1 text-[12px] text-ink-3">
        這裡是全租戶的對外開放總覽與待審佇列。要開放
        <span className="text-ink-2">某一張</span>
        表單,請到那張表單的「工具 › 公開表單設定」—— 在表單上做,
        才不必離開表單後再把同一張表選一次。
      </p>

      <section className="mt-6">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Share2 size={14} className="text-ink-2" />
          目前對外開放的表單
        </h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {(shares?.shares ?? []).map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {s.title}
                <Link
                  href={`/app/forms/${String(s.formId)}`}
                  className="ml-1.5 text-[12px] text-ink-3 hover:text-primary"
                >
                  {nameOf(s.formId)}
                </Link>
              </span>
              <span className="shrink-0 text-[12px] text-ink-3">{s.fieldIds.length} 個欄位</span>
              <span className="shrink-0 text-[12px] text-ink-3">已收 {s.submissionCount} 筆</span>
              {s.active ? null : (
                <span className="shrink-0 rounded-sm border border-line px-1.5 py-px text-[12px] text-ink-3">
                  已關閉
                </span>
              )}
              {/* 關閉 / 重新開放留在這裡:一次看到全部並能立刻收口,是租戶級的緊急控制。
                  與表單層寫的是同一列,不是各存一份 → 沒有「改哪個才算數」的問題。 */}
              <Button
                size="sm"
                variant="subtle"
                onClick={() => toggle.mutate({ id: s.id, action: s.active ? "close" : "open" })}
              >
                {s.active ? "關閉" : "重新開放"}
              </Button>
            </li>
          ))}
          {(shares?.shares ?? []).length === 0 ? (
            <li className="rounded-md border border-line bg-card px-4 py-6 text-center text-[12px] text-ink-3">
              尚未開放任何表單。到表單的「工具 › 公開表單設定」建立。
            </li>
          ) : null}
        </ul>
      </section>

      <section className="mt-8">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Inbox size={14} className="text-ink-2" />
          待審收件匣
          {(inbox?.submissions ?? []).length === 0 ? null : (
            <span className="rounded-sm bg-primary-t px-1.5 py-px text-[12px] text-primary">
              {(inbox?.submissions ?? []).length}
            </span>
          )}
        </h3>
        <p className="mt-1 text-[12px] text-ink-3">
          外部提交在這裡等你確認。核准後才會建立正式記錄、取得編號並進入後續流程。
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {(inbox?.submissions ?? []).map((s) => (
            <li key={s.id} className="rounded-md border border-line bg-card px-3 py-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {/* 🔴 跨表單佇列必須說出「哪一張表」—— 少了它,審核者是在
                      沒有上下文的情況下決定要不要讓一筆資料進系統。 */}
                  <div className="text-[12px] font-medium text-ink-2">{nameOf(s.formId)}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink">
                    {Object.entries(s.values).map(([k, v]) => (
                      <span key={k}>
                        <span className="text-ink-3">{k}:</span>
                        {String(v)}
                      </span>
                    ))}
                  </div>
                  <span className="text-[12px] text-ink-3">
                    {new Date(s.createdAt).toLocaleString("zh-TW")}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ id: s.id, action: "promote" })}
                >
                  核准建立
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ id: s.id, action: "reject", reason: "不符需求" })}
                >
                  退回
                </Button>
              </div>
            </li>
          ))}
          {(inbox?.submissions ?? []).length === 0 ? (
            <li className="rounded-md border border-line bg-card px-4 py-6 text-center text-[12px] text-ink-3">
              沒有待審的提交。
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  )
}
