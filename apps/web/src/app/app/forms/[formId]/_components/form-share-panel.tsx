"use client"

import {
  useCreateShare,
  usePublicSafeTypes,
  usePublicShares,
  useReviewSubmission,
  useShareToggle,
  useSubmissionInbox,
} from "@/lib/engine/hooks"
import type { FormDto } from "@/lib/engine/schemas"
import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { AlertTriangle, Copy, Inbox, Share2, X } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"

/* 🔴 R1·IA 第二階段|「這張表單的公開設定」,開在表單上。

   Ragic 設計手冊 doc/71 逐字:per-form 的對外設定「在列表頁的**工具**中找到」,
   且「同樣可以這個視窗點選……**如此一來就不需要進到修改設計中調整**」。
   第一階段只做到深連過去設定中心;此處把面板本身搬過來。

   ⚠️ **範圍誠實**:Ragic 的「發佈到網路」是把資料發佈成可下載檔案,
   與這裡的「匿名填寫」不是同一個功能。可承重的只有落點與形態。

   **不再需要選表單** —— 那個下拉正是 `docs/33 §2.1` 記載的 IA 錯位本身。
   清單與收件匣都**只顯示這張表的**;兩個 DTO 都帶 formId,在前端收斂即可,
   不為此新增一組查詢參數(來源清單本身已受 admin 閘門保護且有上限)。 */
export function FormSharePanel({
  formId,
  form,
  onClose,
}: {
  readonly formId: number
  readonly form: FormDto
  readonly onClose: () => void
}): ReactNode {
  const { data: shares } = usePublicShares()
  const { data: safeTypes } = usePublicSafeTypes()
  const { data: inbox } = useSubmissionInbox()
  const createShare = useCreateShare()
  const toggle = useShareToggle()
  const review = useReviewSubmission()

  const [title, setTitle] = useState("")
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [issued, setIssued] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* 🔴 只列**可公開的型別**。挑得到但一定被拒的欄位,是「設計期沒擋」的老問題
     (同 OQ-PC-11)。清單由後端回,前端不自己維護一份。
     ⚠️ 載入前先不列 —— 寧可少列,也不要列一個按下去被拒的欄位。 */
  const safe = new Set(safeTypes?.types ?? [])
  const publishable = form.fields.filter((f) => safe.has(f.type))
  const excluded = form.fields.length - publishable.length

  const mine = (shares?.shares ?? []).filter((s) => s.formId === formId)
  const pending = (inbox?.submissions ?? []).filter((s) => s.formId === formId)

  const onCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const res = await createShare.mutateAsync({ formId, title, fieldIds: [...picked] })
      setIssued(`${window.location.origin}/f/${res.token}`)
      setTitle("")
      setPicked(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗")
    }
  }

  return (
    <div className="mx-auto w-full max-w-[820px] p-6">
      <div className="mb-1 flex items-center gap-2">
        <Share2 size={15} className="text-ink-2" />
        <h2 className="text-[16px] font-semibold text-ink">公開表單 · {form.name}</h2>
        <Button className="ml-auto" onClick={onClose}>
          <X size={12} className="mr-1" />
          關閉
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        把這張表單開放給未登入的外部人填寫。提交內容會先進待審,由你確認後才成為正式資料 ——
        不會直接吃單號或觸發簽核。
      </p>

      {error === null ? null : (
        <div className="mt-3 rounded-sm border border-er-line bg-er-t px-2.5 py-1.5 text-[13px] text-er">
          {error}
        </div>
      )}
      {issued === null ? null : (
        <div className="mt-3 rounded-sm border border-warn-line bg-warn-t px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[12px] text-ink">
            <AlertTriangle size={13} className="shrink-0 text-warn" />
            填寫連結 —— <span className="text-ink-2">只顯示這一次,關閉後無法再取得</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-sm bg-head px-2 py-1 font-mono text-[12px] text-ink">
              {issued}
            </code>
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(issued)}>
              <Copy size={12} className="mr-1" />
              複製
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={(e) => void onCreate(e)} className="mt-4 flex flex-col gap-2">
        <Input
          placeholder="對外標題(例:2026 供應商報價單)"
          aria-label="對外標題"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {/* 🔴 白名單為 opt-in(OQ-PF-1):預設全不勾,逐一決定要開放哪些欄位。
            排除制在「日後有人加一個成本欄」那一刻就外洩,而使用者不會意識到。 */}
        <div className="flex flex-col gap-1 rounded-sm border border-line bg-surface p-2">
          <p className="text-[12px] text-ink-3">
            勾選要開放給外部填寫的欄位。
            <span className="text-ink-2">未勾選的欄位外部看不到、也送不進來</span>;
            帶入欄、自動編號、附件等型別不得公開。
          </p>
          {publishable.length === 0 ? (
            <p className="text-[12px] text-ink-3">
              {form.fields.length === 0 ? "這張表單還沒有欄位。" : "這張表單沒有可公開的欄位。"}
            </p>
          ) : (
            publishable.map((f) => (
              <label key={f.id} className="flex items-center gap-1.5 text-[12px] text-ink">
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={picked.has(f.id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(f.id)) next.delete(f.id)
                      else next.add(f.id)
                      return next
                    })
                  }
                />
                {f.name}
                <span className="text-[12px] text-ink-3">{f.type}</span>
              </label>
            ))
          )}
          {/* 🔴 少列了東西就要說 —— 靜默省略會讓人以為欄位不見了 */}
          {excluded > 0 ? (
            <p className="text-[12px] text-ink-3">
              另有 {excluded} 個欄位不能公開(自動編號、帶入欄、附件、人員等)。
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          variant="primary"
          className="self-start"
          disabled={title === "" || picked.size === 0 || createShare.isPending}
        >
          建立填寫連結
        </Button>
      </form>

      <ul className="mt-3 flex flex-col gap-1.5">
        {mine.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-md border border-line bg-card px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.title}</span>
            <span className="shrink-0 text-[12px] text-ink-3">{s.fieldIds.length} 個欄位</span>
            <span className="shrink-0 text-[12px] text-ink-3">已收 {s.submissionCount} 筆</span>
            {s.active ? null : (
              <span className="shrink-0 rounded-sm border border-line px-1.5 py-px text-[12px] text-ink-3">
                已關閉
              </span>
            )}
            <Button
              size="sm"
              variant="subtle"
              onClick={() => toggle.mutate({ id: s.id, action: s.active ? "close" : "open" })}
            >
              {s.active ? "關閉" : "重新開放"}
            </Button>
          </li>
        ))}
        {mine.length === 0 ? (
          <li className="rounded-md border border-line bg-card px-4 py-6 text-center text-[12px] text-ink-3">
            這張表單尚未開放給外部填寫。
          </li>
        ) : null}
      </ul>

      <h3 className="mt-6 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Inbox size={14} className="text-ink-2" />
        這張表單的待審提交
        {pending.length === 0 ? null : (
          <span className="rounded-sm bg-primary-t px-1.5 py-px text-[12px] text-primary">
            {pending.length}
          </span>
        )}
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {pending.map((s) => (
          <li key={s.id} className="rounded-md border border-line bg-card px-3 py-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
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
        {pending.length === 0 ? (
          <li className="rounded-md border border-line bg-card px-4 py-6 text-center text-[12px] text-ink-3">
            沒有待審的提交。
          </li>
        ) : null}
      </ul>
    </div>
  )
}
