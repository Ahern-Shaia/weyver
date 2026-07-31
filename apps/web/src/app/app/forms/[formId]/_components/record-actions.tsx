"use client"

import { CheckCircle2, CircleSlash, ExternalLink, Play, Send, Undo2 } from "lucide-react"
import { type ReactNode, useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import {
  useButtons,
  useDecideApproval,
  useRecordApproval,
  useRunButton,
  useSubmitApproval,
  useWithdrawApproval,
} from "@/lib/engine/hooks"
import type { ApprovalInstanceDto, ButtonDto } from "@/lib/engine/schemas"

/* R1·後續-1 M3 記錄頁動作區:自訂按鈕(確認 → 執行)+ 簽核(送簽 / 狀態章 / 步驟進度 / 決策)。
   簽核中記錄由後端 interceptor 鎖(409);此處僅呈現狀態與可用動作。 */

const STATUS_LABEL: Record<ApprovalInstanceDto["status"], string> = {
  pending: "簽核中",
  approved: "已核准",
  rejected: "已退回",
  withdrawn: "已撤回",
}

const STATUS_CLASS: Record<ApprovalInstanceDto["status"], string> = {
  pending: "border-warn-line bg-warn-t text-warn",
  approved: "border-ok-line bg-ok-t text-ok",
  rejected: "border-er-line bg-er-t text-er",
  withdrawn: "border-line bg-label text-ink-3",
}

export function RecordActions({
  formId,
  recordId,
}: {
  readonly formId: number
  readonly recordId: number
}): ReactNode {
  const { data: buttons = [] } = useButtons(formId)
  const { data: approval } = useRecordApproval(formId, recordId)
  const runButton = useRunButton(formId)
  const submitApproval = useSubmitApproval(formId)
  const decide = useDecideApproval()
  const withdraw = useWithdrawApproval()
  const [msg, setMsg] = useState<string | null>(null)

  const instance = approval?.instance ?? null
  const locked = instance?.status === "pending"

  const onRun = (button: ButtonDto): void => {
    if (button.confirm && !window.confirm(`執行「${button.label}」?`)) return
    setMsg(null)
    runButton.mutate(
      { buttonId: button.id, recordId },
      {
        onSuccess: (result) => {
          if (result.outcome === "openUrl" && result.url) {
            window.open(result.url, "_blank", "noopener,noreferrer")
            return
          }
          setMsg(
            result.outcome === "duplicate"
              ? "此動作已執行過(冪等,未重複執行)"
              : result.outcome === "created"
                ? `已建立目標記錄 #${result.targetRecordId}`
                : "已更新本筆",
          )
        },
        onError: (e) => setMsg(describeEngineError(e)),
      },
    )
  }

  if (buttons.length === 0 && instance === null) return null

  return (
    <div data-noprint className="border-b border-line bg-card px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {instance !== null ? (
          <span
            className={`inline-flex items-center gap-1 rounded-xs border px-2 py-0.5 text-[12px] ${STATUS_CLASS[instance.status]}`}
          >
            {STATUS_LABEL[instance.status]}
            {instance.status === "pending" ? ` · 第 ${instance.currentStep} 關` : ""}
          </span>
        ) : null}

        {buttons.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onRun(b)}
            disabled={runButton.isPending || (locked && b.actionType !== "openUrl")}
            className="flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-[12px] text-ink-3 hover:border-primary hover:text-primary disabled:opacity-40"
            title={locked && b.actionType !== "openUrl" ? "簽核中,不可執行寫入動作" : undefined}
          >
            {b.actionType === "openUrl" ? <ExternalLink size={13} /> : <Play size={13} />}
            {b.label}
          </button>
        ))}

        {instance === null || instance.status !== "pending" ? (
          <button
            type="button"
            onClick={() =>
              submitApproval.mutate(recordId, {
                onSuccess: () => setMsg("已送出簽核"),
                onError: (e) => setMsg(describeEngineError(e)),
              })
            }
            disabled={submitApproval.isPending}
            className="flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-[12px] text-ink-3 hover:border-primary hover:text-primary disabled:opacity-40"
          >
            <Send size={13} />
            送簽
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                decide.mutate(
                  { instanceId: instance.id, decision: "approve" },
                  {
                    onSuccess: (r) =>
                      setMsg(
                        r.status === "approved" ? "簽核完成" : `已核准,進入第 ${r.currentStep} 關`,
                      ),
                    onError: (e) => setMsg(describeEngineError(e)),
                  },
                )
              }
              className="flex items-center gap-1 rounded-xs border border-ok-line px-2 py-1 text-[12px] text-ok hover:bg-ok-t"
            >
              <CheckCircle2 size={13} />
              核准
            </button>
            <button
              type="button"
              onClick={() =>
                decide.mutate(
                  { instanceId: instance.id, decision: "reject" },
                  {
                    onSuccess: () => setMsg("已退回"),
                    onError: (e) => setMsg(describeEngineError(e)),
                  },
                )
              }
              className="flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-[12px] text-er hover:border-er hover:bg-er-t"
            >
              <CircleSlash size={13} />
              退回
            </button>
            <button
              type="button"
              onClick={() =>
                withdraw.mutate(instance.id, {
                  onSuccess: () => setMsg("已撤回"),
                  onError: (e) => setMsg(describeEngineError(e)),
                })
              }
              className="flex items-center gap-1 rounded-xs border border-line px-2 py-1 text-[12px] text-ink-3 hover:border-primary hover:text-primary"
            >
              <Undo2 size={13} />
              撤回
            </button>
          </>
        )}
      </div>

      {instance !== null && instance.log.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-2 font-mono text-[12px] text-ink-3">
          {instance.log.map((l, i) => (
            <span key={`${l.at}-${i}`}>
              {l.decision === "submit"
                ? "送簽"
                : l.decision === "approve"
                  ? "核准"
                  : l.decision === "reject"
                    ? "退回"
                    : "撤回"}
              ·#{l.actorId}·{l.at.slice(5, 16).replace("T", " ")}
            </span>
          ))}
        </div>
      ) : null}

      {msg !== null ? <div className="mt-1.5 text-[12px] text-ink-2">{msg}</div> : null}
    </div>
  )
}
