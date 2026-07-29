"use client"

import { Button } from "@weyver/ui/button"
import { RefreshCw } from "lucide-react"
import { type ReactNode, useState } from "react"
import { z } from "zod"
import { describeEngineError, engineFetch } from "@/lib/engine/client"

/* 🔴 快照帶入的重整(#113)。

   Ragic 的對應功能按下去就直接覆蓋:沒有預覽、沒有差異、沒有逐筆記錄,
   其官方 KB 甚至另闢專篇教使用者「被覆蓋後怎麼從備份救回來」。
   這裡刻意反過來 —— 先看「會改幾筆、改成什麼」,確認了才寫。 */

const resultSchema = z.object({
  total: z.number(),
  changed: z.number(),
  samples: z.array(
    z.object({
      recordId: z.number(),
      before: z.string().nullable(),
      after: z.string().nullable(),
    }),
  ),
  applied: z.boolean(),
})
type RelookupResult = z.infer<typeof resultSchema>

export function RelookupPanel({
  formId,
  fieldId,
  onDone,
}: {
  readonly formId: number
  readonly fieldId: number
  readonly onDone: () => void
}): ReactNode {
  const [preview, setPreview] = useState<RelookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (dryRun: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await engineFetch(`/forms/${formId}/fields/${fieldId}/relookup`, resultSchema, {
        method: "POST",
        body: { dryRun },
      })
      setPreview(res)
      if (res.applied) onDone()
    } catch (e) {
      setError(describeEngineError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 border border-line bg-card p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
        <RefreshCw size={12} className="text-ink-3" />
        從來源重新帶入
      </div>
      <p className="mb-2 text-[10.5px] leading-relaxed text-ink-3">
        這個欄位保留的是填單當時的內容。若要改成來源主檔的現況,先試算再套用。
      </p>

      {preview === null ? null : (
        <div className="mb-2 space-y-1.5">
          <div className="text-[11.5px] text-ink">
            {preview.changed === 0 ? (
              <span className="text-ink-3">全部 {preview.total} 筆都與來源一致,沒有要改的。</span>
            ) : (
              <>
                共 {preview.total} 筆,其中 <b>{preview.changed}</b> 筆會被改寫
              </>
            )}
          </div>
          {preview.samples.length === 0 ? null : (
            <ul className="divide-y divide-line border border-line">
              {preview.samples.map((s) => (
                <li key={s.recordId} className="flex items-center gap-2 px-2 py-1 text-[10.5px]">
                  <span className="w-10 shrink-0 font-mono text-ink-4">#{s.recordId}</span>
                  <span className="truncate text-ink-3 line-through">{s.before ?? "—"}</span>
                  <span className="shrink-0 text-ink-4">→</span>
                  <span className="truncate text-ink">{s.after ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.changed > preview.samples.length ? (
            <div className="text-[10px] text-ink-4">僅列出前 {preview.samples.length} 筆</div>
          ) : null}
        </div>
      )}

      {error === null ? null : <div className="mb-2 text-[11px] text-er">{error}</div>}

      <div className="flex gap-1.5">
        <Button variant="subtle" size="sm" disabled={busy} onClick={() => void run(true)}>
          試算差異
        </Button>
        <Button
          size="sm"
          disabled={busy || preview === null || preview.changed === 0 || preview.applied}
          onClick={() => void run(false)}
        >
          套用
        </Button>
      </div>
    </div>
  )
}
