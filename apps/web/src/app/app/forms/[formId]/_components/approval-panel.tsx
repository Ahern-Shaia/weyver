"use client"

import { describeEngineError } from "@/lib/engine/client"
import {
  useAddApprover,
  useDecideApproval,
  useReturnApproval,
  useUnlockApproval,
  useWithdrawApproval,
} from "@/lib/engine/hooks"
import type { ApprovalInstanceDto } from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { CheckCircle2, CircleSlash, LockOpen, Undo2, UserPlus } from "lucide-react"
import { type ReactNode, useState } from "react"

/* R1·後續-1b M6|簽核中的動作區。**自 `record-actions.tsx` 拆出**(該檔原本 192 行,
   加上駁回理由 / 退回目標 / 加簽 / 會簽進度會直接超過紅線)。

   🔴 **這一批同時修掉一個一直是壞的按鈕**:原本標「退回」的那顆送的是
   `decision: reject` 而且**不帶理由**,而後端自 #103 起強制駁回必填理由
   —— 也就是說那顆按鈕按下去一定回 400,而沒有任何測試覆蓋它。

   順帶把詞分開:M4 之後「退回」是真的退回到某一關,原本那顆是**駁回**。
   兩個詞混用的話,使用者按下去會得到完全不同的結果。 */

const DECISION_LABEL: Record<string, string> = {
  submit: "送簽",
  approve: "核准",
  reject: "駁回",
  return: "退回",
  withdraw: "撤回",
  unlock: "強制解鎖",
  addApprover: "加簽",
}

/* 需要填理由才能送出的動作。共用一個輸入框 —— 三個各自一個框會把動作列撐爛,
   而且同時只會進行其中一個。 */
type Prompt = {
  kind: "reject" | "return" | "unlock" | "addApprover"
  targetStep?: number | undefined
}

const PROMPT_HINT: Record<Prompt["kind"], string> = {
  reject: "駁回理由(必填)",
  return: "退回理由(必填)—— 對方要知道該改什麼",
  unlock: "解鎖理由(必填)—— 這是繞過內控的動作,會留下紀錄",
  addApprover: "要加簽給誰(成員編號)",
}

export function ApprovalPanel({
  instance,
  onMessage,
}: {
  readonly instance: ApprovalInstanceDto
  readonly onMessage: (msg: string) => void
}): ReactNode {
  const decide = useDecideApproval()
  const returnTo = useReturnApproval()
  const addApprover = useAddApprover()
  const unlock = useUnlockApproval()
  const withdraw = useWithdrawApproval()
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [text, setText] = useState("")

  const fail = (e: unknown): void => onMessage(describeEngineError(e))
  const close = (): void => {
    setPrompt(null)
    setText("")
  }

  /* 可退回的關卡:目前關卡之前的,再套該關的 `returnableTo` 白名單。
     白名單未設 = 全部先前關卡(與後端同一條規則)。 */
  const currentDef = instance.steps.find((s) => s.stepNo === instance.currentStep)
  const returnTargets = instance.steps
    .filter((s) => s.stepNo < instance.currentStep)
    .filter(
      (s) => currentDef?.returnableTo === undefined || currentDef.returnableTo.includes(s.stepNo),
    )
    .map((s) => s.stepNo)

  const submitPrompt = (): void => {
    if (prompt === null) return
    const value = text.trim()
    if (value === "") {
      onMessage("請填寫內容")
      return
    }
    const done = (msg: string) => (): void => {
      onMessage(msg)
      close()
    }
    if (prompt.kind === "reject") {
      decide.mutate(
        { instanceId: instance.id, decision: "reject", comment: value },
        { onSuccess: done("已駁回"), onError: fail },
      )
    } else if (prompt.kind === "return") {
      const target = prompt.targetStep ?? returnTargets[0]
      if (target === undefined) {
        onMessage("沒有可退回的關卡")
        return
      }
      returnTo.mutate(
        { instanceId: instance.id, targetStep: target, comment: value },
        {
          onSuccess: () => {
            /* 🔴 明講「要重跑」。業界唯一的預設就是全部重簽(Kissflow 自承是痛點),
               不講的話使用者會以為只補簽那一關。 */
            onMessage(`已退回第 ${String(target)} 關 —— 重新送出後,該關之後全部需要重簽`)
            close()
          },
          onError: fail,
        },
      )
    } else if (prompt.kind === "unlock") {
      unlock.mutate(
        { instanceId: instance.id, comment: value },
        { onSuccess: done("已強制解鎖,簽核繼續進行"), onError: fail },
      )
    } else {
      const actorId = Number(value)
      if (!Number.isSafeInteger(actorId) || actorId <= 0) {
        onMessage("請填有效的成員編號")
        return
      }
      addApprover.mutate(
        { instanceId: instance.id, actorId },
        { onSuccess: done("已加簽"), onError: fail },
      )
    }
  }

  const busy = decide.isPending || returnTo.isPending || addApprover.isPending || unlock.isPending

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          decide.mutate(
            { instanceId: instance.id, decision: "approve" },
            {
              onSuccess: (r) =>
                onMessage(
                  r.status === "approved"
                    ? "簽核完成"
                    : r.currentStep === instance.currentStep
                      ? /* 會簽未達門檻 —— 不講的話使用者以為自己按了沒反應 */
                        `已核准,本關還需其他人核准(${String(r.stepProgress.approved)}/${String(r.stepProgress.required)})`
                      : `已核准,進入第 ${String(r.currentStep)} 關`,
                ),
              onError: fail,
            },
          )
        }
        className="flex items-center gap-1 rounded-xs border border-ok-line px-2 py-1 text-[12px] text-ok hover:bg-ok-t disabled:opacity-40"
      >
        <CheckCircle2 size={13} />
        核准
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => setPrompt({ kind: "reject" })}
        className="flex items-center gap-1 rounded-xs px-2 py-1 text-[12px] text-er hover:border-er hover:bg-er-t disabled:opacity-40"
      >
        <CircleSlash size={13} />
        駁回
      </button>

      {returnTargets.length > 0 ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setPrompt({ kind: "return", targetStep: returnTargets[0] })}
          className="flex items-center gap-1 rounded-xs px-2 py-1 text-[12px] text-ink-3 hover:text-primary hover:bg-hover disabled:opacity-40"
        >
          <Undo2 size={13} />
          退回
        </button>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => setPrompt({ kind: "addApprover" })}
        className="flex items-center gap-1 rounded-xs px-2 py-1 text-[12px] text-ink-3 hover:text-primary hover:bg-hover disabled:opacity-40"
      >
        <UserPlus size={13} />
        加簽
      </button>

      {instance.unlockedAt === null ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setPrompt({ kind: "unlock" })}
          className="flex items-center gap-1 rounded-xs px-2 py-1 text-[12px] text-ink-3 hover:text-primary hover:bg-hover disabled:opacity-40"
        >
          <LockOpen size={13} />
          強制解鎖
        </button>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          withdraw.mutate(instance.id, {
            onSuccess: () => onMessage("已撤回"),
            onError: fail,
          })
        }
        className="flex items-center gap-1 rounded-xs px-2 py-1 text-[12px] text-ink-3 hover:text-primary hover:bg-hover disabled:opacity-40"
      >
        <Undo2 size={13} />
        撤回
      </button>

      {prompt !== null ? (
        <form
          className="flex w-full items-center gap-1.5 pt-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            submitPrompt()
          }}
        >
          {prompt.kind === "return" && returnTargets.length > 1 ? (
            <Select
              className="h-7 w-28"
              aria-label="退回到哪一關"
              value={String(prompt.targetStep ?? returnTargets[0])}
              onChange={(e) => setPrompt({ kind: "return", targetStep: Number(e.target.value) })}
            >
              {returnTargets.map((n) => (
                <option key={n} value={n}>
                  退回第 {n} 關
                </option>
              ))}
            </Select>
          ) : null}
          <Input
            className="h-7 flex-1"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PROMPT_HINT[prompt.kind]}
            aria-label={PROMPT_HINT[prompt.kind]}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xs border border-line px-2 py-1 text-[12px] text-ink hover:bg-hover disabled:opacity-40"
          >
            確定
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-xs px-2 py-1 text-[12px] text-ink-3 hover:bg-hover"
          >
            取消
          </button>
        </form>
      ) : null}
    </>
  )
}

export function ApprovalTrail({ instance }: { readonly instance: ApprovalInstanceDto }): ReactNode {
  if (instance.log.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-2 font-mono text-[12px] text-ink-3">
      {instance.log.map((l, i) => (
        <span key={`${l.at}-${String(i)}`} title={l.comment ?? undefined}>
          {DECISION_LABEL[l.decision] ?? l.decision}·#{l.actorId}·
          {l.at.slice(5, 16).replace("T", " ")}
        </span>
      ))}
    </div>
  )
}
