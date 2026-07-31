"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Check, Copy } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import { BusyBar, FirstLoad } from "@/components/busy-indicator"
import { describeEngineError } from "@/lib/engine/client"
import {
  type CreatedMember,
  type Member,
  useCreateMember,
  useMembers,
  useSetMemberStatus,
} from "@/lib/engine/use-members"

/* R1·A-1 M2|使用者管理(S22 之租戶軸)。

   ## 🔴 初始密碼只顯示這一次

   ASVS §V6.4.1:初始憑證「must not be permitted to become the long term password」,
   且系統產生、短效期、用過即失效。它**不會再被查到** —— 所以這個畫面必須說清楚
   「現在不複製走,就只能重發」,而不是讓管理員以為之後找得到。

   15 個字元是 NIST 63B-4 §3.1.1.2 的單因子門檻(rev 3 的 6 字豁免已刪除)。
   **15 字唸不出來** —— 所以主要動作是「複製」而不是「請唸給對方聽」,
   字元集也刻意避開 0/O/1/l/I(見後端 initial-password.ts)。

   ## 為什麼沒有「設定密碼」欄位

   ASVS §V6.4.6 逐字反對管理員「change or choose the user's password」,
   理由是「prevents a situation where they know the user's password」。
   此處連輸入框都不提供 —— 保證來自介面形狀,不是靠檢核。
   ⚠️ 此點**刻意不照 Ragic**(Ragic 支援「設定預設密碼」)。

   ## 停用而非刪除

   承 Ragic 官方:「推薦作法是將離職員工的帳號停權…不建議直接刪除使用者,
   避免失去使用者的資料」。記錄的建立者 / 簽核對象都指向 actor,刪掉會讓歷史單據
   失去可解釋性。故本頁**沒有刪除**。 */

export default function MembersPage(): ReactNode {
  const { data, error: loadError } = useMembers()
  const create = useCreateMember()
  const setStatus = useSetMemberStatus()
  const [adding, setAdding] = useState(false)
  const [issued, setIssued] = useState<CreatedMember | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* 🔴 查詢失敗必須說出來。原本只有 `data === undefined → FirstLoad`,
     一旦請求出錯就永遠停在「載入中…」—— 使用者無從得知是慢還是壞了。 */
  if (loadError !== null) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-[13px] text-er">載入成員清單失敗:{describeEngineError(loadError)}</p>
      </main>
    )
  }
  if (data === undefined) return <FirstLoad />

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-[16px] font-semibold text-ink">成員</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          公司的使用者。離職請改用「停用」保留其歷史資料,不要刪除帳號。
        </p>
      </div>

      {issued === null ? null : <IssuedPassword created={issued} onDone={() => setIssued(null)} />}

      <div className="relative overflow-hidden rounded-sm border border-line bg-card">
        <BusyBar busy={setStatus.isPending || create.isPending} />
        {data.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-ink-3">尚無成員</p>
        ) : (
          <ul>
            {data.map((m, i) => (
              <li
                key={m.actorId}
                className={`flex items-center gap-3 px-4 py-2.5 ${i === 0 ? "" : "border-t border-line-2"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{m.name ?? m.email}</span>
                  <span className="block truncate text-[12px] text-ink-3">{m.email}</span>
                </span>
                <StatusTags member={m} />
                <Button
                  variant={m.status === "suspended" ? "subtle" : "danger"}
                  disabled={setStatus.isPending}
                  onClick={() =>
                    setStatus.mutate({
                      actorId: m.actorId,
                      status: m.status === "suspended" ? "active" : "suspended",
                    })
                  }
                  className="shrink-0 text-[12px]"
                >
                  {m.status === "suspended" ? "復用" : "停用"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {adding ? (
        <AddForm
          busy={create.isPending}
          error={error}
          onCancel={() => {
            setAdding(false)
            setError(null)
          }}
          onSubmit={async (email, name) => {
            setError(null)
            try {
              const r = await create.mutateAsync({ email, name })
              setIssued(r)
              setAdding(false)
            } catch (e) {
              setError(describeEngineError(e))
            }
          }}
        />
      ) : (
        <Button variant="primary" onClick={() => setAdding(true)} className="w-fit">
          新增成員
        </Button>
      )}
    </main>
  )
}

function StatusTags({ member }: { readonly member: Member }): ReactNode {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {member.status === "suspended" ? (
        <Tag tone="er">已停用</Tag>
      ) : member.credential === "pending" ? (
        <Tag tone="wn">未啟用</Tag>
      ) : member.credential === "expired" ? (
        <Tag tone="er">初始密碼已過期</Tag>
      ) : null}
    </span>
  )
}

function Tag({ tone, children }: { readonly tone: "wn" | "er"; readonly children: ReactNode }) {
  const cls = tone === "wn" ? "border-wn-line bg-wn-t text-wn" : "border-er-line bg-er-t text-er"
  return <span className={`rounded-xs border px-1.5 text-[12px] ${cls}`}>{children}</span>
}

/* 🔴 明文只出現這一次的畫面。措辭刻意把「現在不複製就得重發」講明,
   而不是留給管理員事後才發現查不到。 */
function IssuedPassword({
  created,
  onDone,
}: {
  readonly created: CreatedMember
  readonly onDone: () => void
}): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <section className="flex flex-col gap-2 rounded-sm border border-wn-line bg-wn-t p-4">
      <h2 className="text-[13px] font-semibold text-ink">已建立 {created.email}</h2>
      <p className="text-[12px] text-ink-2">
        把下面這組初始密碼交給對方(建議用 LINE 或當面)。
        <strong className="font-semibold">這組密碼只顯示這一次</strong>,關閉後查不到,
        必須重新產生。對方首次登入後會被要求自行設定新密碼。
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all rounded-xs border border-line bg-card px-2 py-1.5 font-mono text-[13px] text-ink">
          {created.initialPassword}
        </code>
        <Button
          variant="primary"
          className="shrink-0"
          onClick={() => {
            void navigator.clipboard.writeText(created.initialPassword)
            setCopied(true)
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span className="ml-1 text-[12px]">{copied ? "已複製" : "複製"}</span>
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        有效期限至 {created.expiresAt.toLocaleString("zh-TW")} —— 逾期未使用需重新產生。
      </p>
      <Button variant="subtle" onClick={onDone} className="w-fit text-[12px]">
        我已經複製好了
      </Button>
    </section>
  )
}

function AddForm({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  readonly busy: boolean
  readonly error: string | null
  readonly onCancel: () => void
  readonly onSubmit: (email: string, name: string) => void
}): ReactNode {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSubmit(email.trim(), name.trim())
      }}
      className="flex flex-col gap-3 rounded-sm border border-line bg-card p-4"
    >
      <h2 className="text-[13px] font-semibold text-ink">新增成員</h2>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-ink-2">Email</span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="colleague@company.com"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-ink-2">姓名</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {/* 🔴 沒有密碼欄位是刻意的 —— 見檔頭 ASVS §V6.4.6 */}
      <p className="text-[12px] text-ink-3">
        系統會產生一組一次性初始密碼,建立後顯示一次。管理員無法自行指定密碼。
      </p>
      {error === null ? null : <p className="text-[12px] text-er">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy} className="w-fit">
          {busy ? "建立中…" : "建立並產生密碼"}
        </Button>
        <Button type="button" variant="subtle" onClick={onCancel} className="w-fit">
          取消
        </Button>
      </div>
    </form>
  )
}
