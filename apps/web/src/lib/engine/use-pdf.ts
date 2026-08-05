"use client"

import { useMutation } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { z } from "zod"

import { downloadFromPath, engineFetch } from "./client"

const jobSchema = z.object({
  id: z.number().int(),
  status: z.enum(["queued", "running", "ready", "failed", "expired"]),
  sizeBytes: z.number().nullable(),
  recordCount: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
})

/* 輪詢間隔。伺服器端的 worker 是 5 秒撿一次件,所以查得比它快沒有意義。 */
const POLL_MS = 1_500
/* 放棄的時限。渲染器本身硬逾時 30 秒,加上排隊,90 秒仍未好就是出事了 ——
   讓使用者一直看著轉圈比告訴他失敗更糟。 */
const GIVE_UP_MS = 90_000

export type PdfState = { kind: "idle" } | { kind: "working" } | { kind: "failed"; message: string }

/* 🔴 R1·後續-2b M1|請一份 PDF。

   非同步(OQ-PDF-4):送出 → 輪詢 → 好了自己下載。
   使用者看到的是一個按鈕,中間的三段對他不存在 —— 這是刻意的,
   「產檔中」的狀態機不該外洩給按按鈕的人。 */
export function useRecordPdf(): {
  state: PdfState
  request: (formId: number, recordIds: readonly number[]) => void
} {
  const [state, setState] = useState<PdfState>({ kind: "idle" })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mutation = useMutation({
    mutationFn: (input: { formId: number; recordIds: readonly number[] }) =>
      engineFetch("/pdf", jobSchema, {
        method: "POST",
        body: { formId: input.formId, recordIds: [...input.recordIds] },
      }),
    onSuccess: (job) => {
      setState({ kind: "working" })
      poll(job.id, Date.now())
    },
    onError: (error: Error) => setState({ kind: "failed", message: error.message }),
  })

  function poll(jobId: number, startedAt: number): void {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void engineFetch(`/pdf/jobs/${String(jobId)}`, jobSchema)
        .then((job) => {
          if (job.status === "ready") {
            setState({ kind: "idle" })
            /* 🔴 走帶標頭的 fetch 而不是 `window.location.href` ——
               導覽不會帶 `engineHeaders()`,dev 車道直接 401。
               2026-08-05 真瀏覽器實走抓到的,e2e 只看到「沒有下載事件」。 */
            void downloadFromPath(
              `/pdf/jobs/${String(jobId)}/download`,
              `weyver-${String(jobId)}.pdf`,
            ).catch((error: Error) => setState({ kind: "failed", message: error.message }))
            return
          }
          if (job.status === "failed" || job.status === "expired") {
            setState({ kind: "failed", message: job.error ?? "產生失敗" })
            return
          }
          if (Date.now() - startedAt > GIVE_UP_MS) {
            setState({ kind: "failed", message: "產生逾時,請稍後再試" })
            return
          }
          poll(jobId, startedAt)
        })
        .catch((error: Error) => setState({ kind: "failed", message: error.message }))
    }, POLL_MS)
  }

  return {
    state,
    request: (formId, recordIds) => {
      setState({ kind: "working" })
      mutation.mutate({ formId, recordIds })
    },
  }
}
