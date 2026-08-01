"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import type { ReactNode } from "react"
import { useState } from "react"
import { BusyBar, FirstLoad } from "@/components/busy-indicator"
import { describeEngineError } from "@/lib/engine/client"
import {
  type Delegate,
  useCreateDelegate,
  useDelegates,
  useRevokeDelegate,
} from "@/lib/engine/use-delegates"
import { useMembers } from "@/lib/engine/use-members"

/* #104|簽核代理人(個人設定)。

   🔴 **兩個方向都要看得見。** 只列「我指定的代理人」的話,被指定的那一方
   會在簽核匣裡看到一堆不屬於自己的單,而畫面上沒有任何線索解釋為什麼 ——
   那看起來就像系統出錯。故另立一區「我代理的人」。

   期間留白 = 立即生效、無限期。這是最常見的用法(離職交接),
   不該逼使用者先想清楚哪天結束才能按下送出。 */

export default function DelegatesPage(): ReactNode {
  const { data } = useDelegates()
  const { data: members } = useMembers()
  const create = useCreateDelegate()
  const revoke = useRevokeDelegate()
  const [delegateId, setDelegateId] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (data === undefined) return <FirstLoad />

  const nameOf = (actorId: number): string => {
    const m = members?.find((x) => x.actorId === actorId)
    return m?.name ?? m?.email ?? `#${String(actorId)}`
  }

  const submit = (): void => {
    setError(null)
    const id = Number(delegateId)
    if (!Number.isSafeInteger(id) || id <= 0) return
    create.mutate(
      {
        delegateActorId: id,
        /* date input 給的是本地日期;當天結束才失效,故取隔日零時 */
        ...(endsAt === "" ? {} : { endsAt: new Date(`${endsAt}T23:59:59`).toISOString() }),
      },
      {
        onSuccess: () => {
          setDelegateId("")
          setEndsAt("")
        },
        onError: (e) => setError(describeEngineError(e)),
      },
    )
  }

  const candidates = (members ?? []).filter(
    (m) => m.actorId !== data.actorId && m.status === "active",
  )

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-[16px] font-semibold text-ink">簽核代理人</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          請假或出差期間,把經過你的簽核交給同事處理。代理人簽出的每一筆都會在稽核紀錄裡註明是代你核准。
        </p>
      </div>

      <section className="relative flex flex-col gap-3 rounded-sm border border-line bg-card p-4">
        <BusyBar busy={create.isPending || revoke.isPending} />
        <h2 className="text-[13px] font-semibold text-ink">我指定的代理人</h2>

        {data.granted.length === 0 ? (
          <p className="text-[12px] text-ink-3">
            尚未指定。你不在時,經過你的單據會停在原地等你回來。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-2 border-y border-line-2">
            {data.granted.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{nameOf(d.delegateActorId)}</span>
                  <span className="block text-[12px] text-ink-3">{periodOf(d)}</span>
                </span>
                <StateTag active={d.active} />
                <Button
                  variant="danger"
                  onClick={() => {
                    setError(null)
                    revoke.mutate(d.id, { onError: (e) => setError(describeEngineError(e)) })
                  }}
                >
                  取消
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[12px] text-ink-2">
            代理人
            <Select
              value={delegateId}
              onChange={(e) => setDelegateId(e.target.value)}
              className="h-7 w-48"
            >
              <option value="">請選擇同事</option>
              {candidates.map((m) => (
                <option key={m.actorId} value={m.actorId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-2">
            代理到(留白 = 無限期)
            <Input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-40"
            />
          </label>
          <Button variant="primary" onClick={submit} disabled={delegateId === ""}>
            新增
          </Button>
        </div>

        {error === null ? null : <p className="text-[12px] text-danger">{error}</p>}
      </section>

      <section className="flex flex-col gap-3 rounded-sm border border-line bg-card p-4">
        <h2 className="text-[13px] font-semibold text-ink">我代理的人</h2>
        {data.received.length === 0 ? (
          <p className="text-[12px] text-ink-3">目前沒有人指定你當代理人。</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-2 border-y border-line-2">
            {data.received.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{nameOf(d.principalActorId)}</span>
                  <span className="block text-[12px] text-ink-3">{periodOf(d)}</span>
                </span>
                <StateTag active={d.active} />
              </li>
            ))}
          </ul>
        )}
        {/* 代理人不得自行解除 —— 授權的一端必須留在授權者手上,故此區沒有取消鈕 */}
        <p className="text-[12px] text-ink-3">
          代理關係只能由指定的人取消。期間內,他的待簽單據會一併出現在你的簽核匣。
        </p>
      </section>
    </main>
  )
}

function periodOf(d: Delegate): string {
  const from = d.startsAt.toLocaleDateString("zh-TW")
  return d.endsAt === null
    ? `${from} 起 · 無限期`
    : `${from} — ${d.endsAt.toLocaleDateString("zh-TW")}`
}

function StateTag({ active }: { readonly active: boolean }): ReactNode {
  return (
    <span
      className={`shrink-0 rounded-xs border px-1.5 py-0.5 text-[12px] ${
        active ? "border-line text-ink-2" : "border-line-2 text-ink-3"
      }`}
    >
      {active ? "生效中" : "未生效"}
    </span>
  )
}
