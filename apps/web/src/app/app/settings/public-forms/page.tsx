"use client"

import { useSearchParams } from "next/navigation"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { AlertTriangle, Copy, Inbox, Share2 } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import {
  useCreateShare,
  useForm,
  useForms,
  usePublicShares,
  useReviewSubmission,
  useShareToggle,
  useSubmissionInbox,
} from "@/lib/engine/hooks"
import { BusyBar } from "@/components/busy-indicator"

/* G-2 M4|公開表單設定 + 待審收件匣。

   **欄位是逐一勾選的,不是「排除幾個」** —— 白名單為 opt-in(OQ-PF-1)。
   UI 必須讓這件事顯而易見:預設全不勾,使用者主動決定每一個要開放的欄位。
   排除制在「日後有人加一個成本欄」那一刻就外洩,而使用者不會意識到。

   **收件匣不是可有可無的中繼站,是刻意的隔離** —— 匿名提交在被人看過之前
   不會進系統、不吃單號、不觸發簽核。UI 用「待審」而非「新資料」措辭。 */

function FieldPicker({
  formId,
  selected,
  onToggle,
}: {
  readonly formId: number | null
  readonly selected: ReadonlySet<number>
  readonly onToggle: (id: number) => void
}): ReactNode {
  const { data: form } = useForm(formId)
  if (formId === null) return null
  const fields = form?.fields ?? []
  if (fields.length === 0) {
    return <p className="text-[12px] text-ink-3">這張表單還沒有欄位。</p>
  }
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-surface p-2">
      <p className="text-[12px] text-ink-3">
        勾選要開放給外部填寫的欄位。
        <span className="text-ink-2">未勾選的欄位外部看不到、也送不進來</span>;
        帶入欄、自動編號、附件等型別不得公開。
      </p>
      {fields.map((f) => (
        <label key={f.id} className="flex items-center gap-1.5 text-[12px] text-ink">
          <input
            type="checkbox"
            className="size-3.5"
            checked={selected.has(f.id)}
            onChange={() => onToggle(f.id)}
          />
          {f.name}
          <span className="text-[12px] text-ink-3">{f.type}</span>
        </label>
      ))}
    </div>
  )
}

export default function PublicFormsPage(): ReactNode {
  const { data: forms } = useForms()
  const { data: shares, isLoading } = usePublicShares()
  const { data: inbox } = useSubmissionInbox()
  const createShare = useCreateShare()
  const toggle = useShareToggle()
  const review = useReviewSubmission()

  /* 🔴 R1·IA-1|接受 `?form=` 預選(docs/33 OQ-IA-3)—— 見 notifications 同一段註解 */
  const preselected = Number(useSearchParams().get("form"))
  const [formId, setFormId] = useState<number | null>(
    Number.isSafeInteger(preselected) && preselected > 0 ? preselected : null,
  )
  const [title, setTitle] = useState("")
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [issued, setIssued] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (formId === null) return
    try {
      const res = await createShare.mutateAsync({
        formId,
        title,
        fieldIds: [...picked],
      })
      setIssued(`${window.location.origin}/f/${res.token}`)
      setTitle("")
      setPicked(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗")
    }
  }

  return (
    <div className="relative mx-auto max-w-[820px] p-6">
      <BusyBar busy={isLoading} />
      <h2 className="text-[16px] font-semibold">公開表單</h2>
      <p className="mt-1 text-[12px] text-ink-3">
        把一張表單開放給未登入的外部人填寫。提交內容會先進待審收件匣, 由你確認後才成為正式資料 ——
        不會直接吃單號或觸發簽核。
      </p>

      {error === null ? null : (
        <div className="mt-3 rounded-sm border border-er-line bg-er-t px-2.5 py-1.5 text-[14px] text-er">
          {error}
        </div>
      )}
      {issued === null ? null : (
        <div className="mt-3 rounded-sm border border-warn/40 bg-warn/5 px-2.5 py-2">
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

      <section className="mt-6">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Share2 size={14} className="text-ink-2" />
          建立分享
        </h3>
        <form onSubmit={(e) => void onCreate(e)} className="mt-2 flex flex-col gap-2">
          <div className="flex gap-1.5">
            <Select
              className="w-52"
              aria-label="來源表單"
              value={formId === null ? "" : String(formId)}
              onChange={(e) => {
                setFormId(e.target.value === "" ? null : Number(e.target.value))
                setPicked(new Set())
              }}
            >
              <option value="">選擇表單</option>
              {(forms ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Input
              className="flex-1"
              placeholder="對外標題(例:2026 供應商報價單)"
              aria-label="對外標題"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <FieldPicker
            formId={formId}
            selected={picked}
            onToggle={(id) =>
              setPicked((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }
          />
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            disabled={formId === null || title === "" || picked.size === 0 || createShare.isPending}
          >
            建立填寫連結
          </Button>
        </form>

        <ul className="mt-3 flex flex-col gap-1.5">
          {(shares?.shares ?? []).map((s) => (
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
          {(shares?.shares ?? []).length === 0 ? (
            <li className="rounded-md border border-line bg-card px-4 py-6 text-center text-[12px] text-ink-3">
              尚未開放任何表單。
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
