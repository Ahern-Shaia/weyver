"use client"

import { Button } from "@weyver/ui/button"
import { Undo2 } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { z } from "zod"
import { describeEngineError, engineFetch } from "@/lib/engine/client"

/* 🔴 匯入紀錄與撤銷(#106)。

   後端一直有 revert 端點,但**沒有清單** —— 使用者根本無從得知 batchId,
   等於功能存在卻不可用。撤銷是本模組對抗「匯入毀資料」的主要護欄,
   看不到就等於沒有。

   撤銷本身也是一筆批次(補償而非刪歷史,AGENTS 鐵則 4),所以列表會同時
   出現原批次與其撤銷批次;已被撤銷者標出來,免得使用者重複按。 */

const batchSchema = z.object({
  id: z.number(),
  kind: z.string(),
  status: z.string(),
  actorId: z.number(),
  stats: z.record(z.string(), z.unknown()),
  committedAt: z.string().nullable(),
  revertOfBatchId: z.number().nullable(),
  revertedByBatchId: z.number().nullable(),
})
type Batch = z.infer<typeof batchSchema>

function statLine(stats: Record<string, unknown>): string {
  const n = (k: string): number => (typeof stats[k] === "number" ? (stats[k] as number) : 0)
  const parts: string[] = []
  if (n("inserted") > 0) parts.push(`新增 ${String(n("inserted"))}`)
  if (n("updated") > 0) parts.push(`更新 ${String(n("updated"))}`)
  if (n("unchanged") > 0) parts.push(`未變 ${String(n("unchanged"))}`)
  if (n("reverted") > 0) parts.push(`還原 ${String(n("reverted"))}`)
  if (n("conflicts") > 0) parts.push(`衝突 ${String(n("conflicts"))}`)
  return parts.length > 0 ? parts.join(" · ") : "—"
}

/* 匯入完成 / 撤銷後由呼叫端 invalidate 這把 key,清單即自動重抓 ——
   剛匯完的批次若沒出現,使用者會以為沒有撤銷這回事(實走時就是這樣看不到的)。 */
export const importBatchKey = (formId: number): readonly unknown[] => [
  "forms",
  formId,
  "import-batches",
]

export function ImportBatches({
  formId,
  onReverted,
}: {
  readonly formId: number
  readonly onReverted: () => void
}): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const { data, refetch } = useQuery({
    queryKey: importBatchKey(formId),
    queryFn: () => engineFetch(`/forms/${String(formId)}/import/batches`, z.array(batchSchema)),
  })
  const batches: Batch[] = data ?? []

  const revert = async (batchId: number): Promise<void> => {
    setBusy(batchId)
    setError(null)
    try {
      await engineFetch(`/forms/${String(formId)}/import/${String(batchId)}/revert`, z.unknown(), {
        method: "POST",
        body: {},
      })
      await refetch()
      onReverted()
    } catch (e) {
      setError(describeEngineError(e))
    } finally {
      setBusy(null)
    }
  }

  if (batches.length === 0) return null

  return (
    <section className="mt-3 border border-line bg-card p-2.5">
      <div className="mb-2 text-[11.5px] font-semibold text-ink">匯入紀錄</div>
      {error === null ? null : <div className="mb-2 text-[13px] text-er">{error}</div>}
      <ul className="divide-y divide-line border border-line">
        {batches.map((b) => (
          <li key={b.id} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
            <span className="w-12 shrink-0 font-mono text-ink-3">#{b.id}</span>
            <span className="w-12 shrink-0 text-ink-3">
              {b.kind === "revert" ? "撤銷" : "匯入"}
            </span>
            <span className="w-36 shrink-0 text-ink-3">
              {b.committedAt === null ? b.status : b.committedAt.replace("T", " ").slice(0, 16)}
            </span>
            <span className="flex-1 truncate text-ink">{statLine(b.stats)}</span>
            {b.kind === "revert" ? null : b.revertedByBatchId !== null ? (
              <span className="shrink-0 text-[10.5px] text-ink-3">
                已由 #{b.revertedByBatchId} 撤銷
              </span>
            ) : (
              <Button
                variant="subtle"
                size="sm"
                disabled={busy === b.id}
                onClick={() => void revert(b.id)}
              >
                <Undo2 size={11} className="mr-1" />
                撤銷
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
