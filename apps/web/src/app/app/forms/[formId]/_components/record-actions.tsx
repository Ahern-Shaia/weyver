"use client"

import { describeEngineError } from "@/lib/engine/client"
import { evaluateApprovalGate, evaluateButtonGate } from "@/lib/engine/conditional-format"
import { useButtons, useRecordApproval, useRunButton, useSubmitApproval } from "@/lib/engine/hooks"
import type { ApprovalInstanceDto, ButtonDto, FormatRule } from "@/lib/engine/schemas"
import { ExternalLink, Play, Send } from "lucide-react"
import { type ReactNode, useState } from "react"
import { ApprovalPanel, ApprovalTrail } from "./approval-panel"

/* R1·後續-1 M3 記錄頁動作區:自訂按鈕(確認 → 執行)+ 簽核(送簽 / 狀態章 / 步驟進度 / 決策)。
   簽核中記錄由後端 interceptor 鎖(409);此處僅呈現狀態與可用動作。 */

const STATUS_LABEL: Record<ApprovalInstanceDto["status"], string> = {
  pending: "簽核中",
  approved: "已核准",
  /* M4 之後「退回」是退回到某一關;這個狀態是**駁回**(整單不成立) */
  rejected: "已駁回",
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
  rules = [],
  values = {},
  fieldNames = [],
}: {
  readonly formId: number
  readonly recordId: number
  /* 🔴 C-3|條件式的「顯示 / 隱藏 / 上鎖動作按鈕」。
     這裡只是畫面 —— **真正的執法在伺服器**(`ButtonService.execute` /
     `ApprovalService.submit`)。畫面照做的理由是別讓使用者按一顆註定失敗的按鈕。 */
  readonly rules?: readonly FormatRule[]
  readonly values?: Record<string, unknown>
  readonly fieldNames?: readonly string[]
}): ReactNode {
  const { data: buttons = [] } = useButtons(formId)
  const { data: approval } = useRecordApproval(formId, recordId)
  const runButton = useRunButton(formId)
  const submitApproval = useSubmitApproval(formId)
  const [msg, setMsg] = useState<string | null>(null)

  const instance = approval?.instance ?? null
  const locked = instance?.status === "pending"
  const approvalGate = evaluateApprovalGate(rules, values, fieldNames)

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
    <div
      data-noprint
      data-testid="record-actions"
      className="border-b border-line bg-card px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {instance !== null ? (
          <span
            /* 🔴 狀態章要能被**單獨**指名。動作區裡同時會出現操作完成的提示訊息,
               而那段文字與狀態章一字不差(「已駁回」)—— 以文字找會同時命中兩個,
               且提示訊息是短暫的,於是整套跑起來時紅得沒有規律。2026-08-04 實際踩到。 */
            data-testid="approval-status"
            className={`inline-flex items-center gap-1 rounded-xs border px-2 py-0.5 text-[12px] ${STATUS_CLASS[instance.status]}`}
          >
            {STATUS_LABEL[instance.status]}
            {instance.status === "pending" ? ` · 第 ${instance.currentStep} 關` : ""}
            {/* 🔴 會簽進度要看得見 —— 否則第一個人簽完之後畫面毫無變化,
                他會以為自己按了沒反應,然後再按一次。 */}
            {instance.status === "pending" && instance.stepProgress.required > 1
              ? ` · ${instance.stepProgress.approved}/${instance.stepProgress.required} 人已核准`
              : ""}
          </span>
        ) : null}

        {buttons.map((b) => {
          const gate = evaluateButtonGate(rules, values, fieldNames, b.id)
          if (gate.hidden) return null
          const blocked = gate.locked
          const lockedByApproval = locked && b.actionType !== "openUrl"
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onRun(b)}
              disabled={runButton.isPending || lockedByApproval || blocked}
              className="flex items-center gap-1 rounded-xs px-2 py-1 text-[12px] text-ink-3 hover:text-primary disabled:opacity-disabled hover:bg-hover"
              title={
                blocked
                  ? /* 官方逐字:上鎖動作按鈕「還可以客製提醒訊息」 */
                    (gate.message ?? "此記錄目前的狀態不允許執行這個動作")
                  : lockedByApproval
                    ? "簽核中,不可執行寫入動作"
                    : undefined
              }
            >
              {b.actionType === "openUrl" ? <ExternalLink size={13} /> : <Play size={13} />}
              {b.label}
            </button>
          )
        })}

        {instance !== null && instance.unlockedAt !== null ? (
          /* 解鎖是繞過內控的狀態,必須在檯面上 —— 不顯示的話沒有人知道這筆現在可以改 */
          <span
            /* 同 `approval-status`:操作完成的提示訊息也含「已強制解鎖」四個字,
               以文字找會同時命中兩個。要斷言哪一個就指名哪一個。 */
            data-testid="approval-unlocked"
            className="inline-flex items-center gap-1 rounded-xs border border-warn-line bg-warn-t px-2 py-0.5 text-[12px] text-warn"
          >
            已強制解鎖
          </span>
        ) : null}

        {approvalGate.hidden ? null : instance === null || instance.status !== "pending" ? (
          <button
            type="button"
            disabled={submitApproval.isPending || approvalGate.locked}
            title={
              approvalGate.locked
                ? (approvalGate.message ?? "此記錄目前的狀態不需要(或不允許)送簽")
                : undefined
            }
            onClick={() =>
              submitApproval.mutate(recordId, {
                onSuccess: () => setMsg("已送出簽核"),
                onError: (e) => setMsg(describeEngineError(e)),
              })
            }
            className="flex items-center gap-1 rounded-xs px-2 py-1 text-[12px] text-ink-3 hover:text-primary disabled:opacity-disabled hover:bg-hover"
          >
            <Send size={13} />
            送簽
          </button>
        ) : (
          <ApprovalPanel instance={instance} onMessage={setMsg} />
        )}
      </div>

      {instance !== null ? <ApprovalTrail instance={instance} /> : null}

      {msg !== null ? <div className="mt-1.5 text-[12px] text-ink-2">{msg}</div> : null}
    </div>
  )
}
