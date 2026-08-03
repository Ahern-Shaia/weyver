"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { StatusChip, type StatusTone } from "@weyver/ui/status-chip"
import { type ReactNode, useState } from "react"
import { EngineApiError, describeEngineError } from "@/lib/engine/client"
import { type ExportJob, isExportActive, useDownloadExport } from "@/lib/engine/use-exports"

/* R1·I-1 M4|封存檔清單的一列。 */

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  queued: { label: "排隊中", tone: "neutral" },
  running: { label: "產生中", tone: "neutral" },
  ready: { label: "可下載", tone: "ok" },
  failed: { label: "失敗", tone: "error" },
  expired: { label: "已過期", tone: "neutral" },
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/* 到期倒數。剩不到一天就改用小時 —— 「0 天後過期」讀起來像「還有一整天」。 */
function formatExpiry(expiresAt: Date | null): string {
  if (expiresAt === null) return ""
  const ms = expiresAt.getTime() - Date.now()
  if (ms <= 0) return "已過期"
  const hours = Math.floor(ms / 3_600_000)
  return hours < 24
    ? `${String(Math.max(1, hours))} 小時後過期`
    : `${String(Math.floor(hours / 24))} 天後過期`
}

export function ExportJobRow({ job }: { readonly job: ExportJob }): ReactNode {
  const download = useDownloadExport()
  /* 🔴 不預先判斷「這個環境要不要密碼」—— 直接送,由後端回 `EXPORT_REAUTH_REQUIRED`
     才顯示密碼欄。dev 車道沒有身分可驗、prod 一定要驗,前端不必各自知道自己在哪。
     再認證發生在扣次數之前,所以這一次往返不會消耗下載次數。 */
  const [askPassword, setAskPassword] = useState(false)
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const meta = STATUS[job.status] ?? { label: job.status, tone: "neutral" as StatusTone }
  const exhausted = job.downloadsLeft <= 0

  const onDownload = async (): Promise<void> => {
    setError(null)
    try {
      await download.mutateAsync({ id: job.id, password: password === "" ? undefined : password })
      setAskPassword(false)
      setPassword("")
    } catch (err) {
      if (err instanceof EngineApiError && err.code === "EXPORT_REAUTH_REQUIRED") {
        setAskPassword(true)
        setError(err.message)
        return
      }
      setPassword("")
      setError(describeEngineError(err))
    }
  }

  return (
    <li className="rounded-md border border-line bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {job.createdAt.toLocaleString("zh-TW")}
          {job.includeAttachments ? (
            <span className="ml-1.5 text-[12px] text-ink-3">含附件</span>
          ) : null}
        </span>
        <span className="shrink-0 font-mono text-[12px] text-ink-3">
          {job.rowCount === null ? "" : `${String(job.rowCount)} 筆 · `}
          {formatSize(job.sizeBytes)}
        </span>
        {job.status === "ready" ? (
          <>
            <span
              className="shrink-0 text-[12px] text-ink-3"
              title={job.expiresAt?.toLocaleString("zh-TW")}
            >
              {formatExpiry(job.expiresAt)} · 剩 {String(job.downloadsLeft)} 次
            </span>
            <Button
              size="sm"
              variant="subtle"
              disabled={download.isPending || exhausted}
              onClick={() => void onDownload()}
            >
              下載
            </Button>
          </>
        ) : null}
      </div>

      {isExportActive(job) ? (
        <p className="mt-1 text-[12px] text-ink-3">
          正在讀取各張表單並寫入封存檔,完成後這裡會自動更新。
        </p>
      ) : null}

      {job.status === "failed" && job.error !== null ? (
        <p className="mt-1 text-[12px] text-er">{job.error}</p>
      ) : null}

      {askPassword ? (
        <form
          className="mt-1.5 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void onDownload()
          }}
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="目前密碼"
            className="max-w-[200px]"
          />
          <Button type="submit" size="sm" variant="primary" disabled={download.isPending}>
            確認下載
          </Button>
        </form>
      ) : null}

      {error !== null ? <p className="mt-1 text-[12px] text-er">{error}</p> : null}
    </li>
  )
}
