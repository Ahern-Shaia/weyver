"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { BASE, EngineApiError, engineFetch, engineHeaders } from "./client"
import { errorEnvelopeSchema } from "./schemas"

/* R1·I-1 M4|資料匯出資料層。

   與畫面上那個「匯出 Excel」是兩件事:後者只含已載入的列,是看的便利;
   這裡是**整個工作區的完整副本**,非同步產生、會過期、限次下載。 */

const jobSchema = z.object({
  id: z.number(),
  status: z.enum(["queued", "running", "ready", "failed", "expired"]).or(z.string()),
  formIds: z.array(z.number()).nullable(),
  includeAttachments: z.boolean(),
  sizeBytes: z.number().nullable(),
  rowCount: z.number().nullable(),
  downloadCount: z.number(),
  /* 剩幾次由後端算 —— 前端自己減會在多分頁時各算各的 */
  downloadsLeft: z.number(),
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
  readyAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
})

const listSchema = z.object({ jobs: z.array(jobSchema), ttlDays: z.number() })

export type ExportJob = z.infer<typeof jobSchema>

export const isExportActive = (job: ExportJob): boolean =>
  job.status === "queued" || job.status === "running"

export function useExports() {
  return useQuery({
    queryKey: ["exports"],
    queryFn: () => engineFetch("/exports", listSchema),
    /* 產生是非同步的,而使用者就站在這一頁等。有工作在跑時輪詢,
       跑完就停 —— 這頁平時不該持續打 API。 */
    refetchInterval: (query) =>
      query.state.data?.jobs.some(isExportActive) === true ? 2_000 : false,
    staleTime: 0,
  })
}

export function useCreateExport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { includeAttachments: boolean }) =>
      engineFetch("/exports", jobSchema, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exports"] }),
  })
}

/* 🔴 下載走 fetch 而不是 `<a href>`:端點是 POST(密碼不能進 URL),
   且 dev 車道要帶 `x-dev-tenant` 標頭。

   回應有兩種形狀,由 content-type 分辨:
   · JSON `{url}` —— driver 能簽名。**用導航去取**,位元組不經應用層也不經記憶體。
     導航不受 CORS 管,故不必為此在儲存桶上開對外的 CORS 設定。
   · zip 位元組 —— driver 不能簽名(local / on-prem),只能代理串流。
     這一半會整份進記憶體;沒有別的選項,因為 GET 帶不了密碼與租戶標頭。
     R1 的量級可接受,真的撞到就是該讓 on-prem 也具備簽名能力。 */
export async function downloadExport(id: number, password: string | undefined): Promise<void> {
  const response = await fetch(`${BASE}/exports/${String(id)}/download`, {
    method: "POST",
    headers: engineHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => ({}))
    const parsed = errorEnvelopeSchema.safeParse(raw)
    throw new EngineApiError(
      response.status,
      parsed.success ? parsed.data.code : "UNKNOWN",
      parsed.success ? parsed.data.message : `HTTP ${String(response.status)}`,
    )
  }

  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    const { url } = z.object({ url: z.string() }).parse(await response.json())
    window.location.assign(url)
    return
  }

  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    const anchor = document.createElement("a")
    anchor.href = objectUrl
    anchor.download = `weyver-export-${String(id)}.zip`
    anchor.click()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function useDownloadExport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: number; password?: string | undefined }) =>
      downloadExport(input.id, input.password),
    /* 下載次數是後端算的,取完要重抓才看得到「剩 4 次」 */
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exports"] }),
  })
}
