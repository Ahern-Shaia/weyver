"use client"

import { useRoles } from "@/lib/engine/authz"
import { describeEngineError } from "@/lib/engine/client"
import { useApprovalDefs, useButtons, useCreateApprovalDef } from "@/lib/engine/hooks"
import type { ApprovalStep, FormDto } from "@/lib/engine/schemas"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { Plus, X } from "lucide-react"
import { type ReactNode, useState } from "react"

/* R1·後續-1b M6|簽核定義編輯器。**自 `actions.tsx` 拆出** ——
   該檔加上簽核進階三個欄位(簽核人規則 / 會簽門檻 / 可退回關卡)後會超過 450 行,
   而簽核定義與自訂按鈕本來就是兩件事(一個是流程,一個是單筆動作)。 */
export function ApprovalPanel({
  formId,
  form,
}: {
  readonly formId: number
  readonly form: FormDto
}): ReactNode {
  const { data: defs = [] } = useApprovalDefs(formId)
  const { data: roles = [], isPending: rolesPending } = useRoles()
  const { data: buttons = [] } = useButtons(formId)
  const createDef = useCreateApprovalDef(formId)
  const [name, setName] = useState("")
  const [steps, setSteps] = useState<ApprovalStep[]>([])
  const [onComplete, setOnComplete] = useState("")
  const [msg, setMsg] = useState<string | null>(null)

  const numericFields = form.fields.filter((f) => ["number", "money", "percent"].includes(f.type))
  /* 🔴 OQ-AP2-9 = C|「記錄上的欄位」的候選就是本表的 member 欄 */
  const memberFields = form.fields.filter((f) => f.type === "member")
  /* 🔴 三個 manager 規則靠**角色樹的父子關係**解析簽核人,
     而角色頁的 UI **刻意是平的**(authz 0-bis 項 1:客戶是行政兼職,階層理解成本才是瓶頸)。
     於是一個從畫面把角色建起來的租戶,永遠沒有父角色 → 這三個規則**恆解不出人**,
     而失敗會等到送簽當下才發生。讓它在選的當下就說實話。 */
  const hasHierarchy = roles.some((r) => r.parentId !== null)

  const addStep = (): void => {
    const firstRole = roles[0]
    if (firstRole === undefined) {
      setMsg("請先於權限頁建立角色")
      return
    }
    setSteps([
      ...steps,
      { stepNo: steps.length + 1, approverRule: "role", approverRoleId: firstRole.id },
    ])
  }

  const submit = (): void => {
    setMsg(null)
    if (name.trim() === "" || steps.length === 0) {
      setMsg("請填名稱並至少加一關")
      return
    }
    createDef.mutate(
      {
        name: name.trim(),
        steps,
        onCompleteButtonId: onComplete === "" ? null : Number(onComplete),
      },
      {
        onSuccess: () => {
          setName("")
          setSteps([])
          setMsg("已建立簽核流程")
        },
        onError: (e) => setMsg(describeEngineError(e)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3 text-[12px]">
      {defs.length > 0 ? (
        <div className="flex flex-col gap-1">
          {defs.map((d) => (
            <div key={d.id} className="rounded-xs border border-line px-2 py-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-ink">{d.name}</span>
                <span className="ml-auto font-mono text-[12px] text-ink-3">
                  {d.steps.length} 關{d.active ? "" : " · 停用"}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-line-2 pt-2.5">
        <span className="text-ink-3">新增簽核流程</span>
        <Input
          className="h-7"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="流程名稱"
        />
        {steps.map((s, i) => (
          <div key={s.stepNo} className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[12px] text-ink-3">第{s.stepNo}關</span>
            {/* 🔴 簽核人規則。動態三種不需要角色 —— 「主管」由組織階層在送簽當下解析,
                所以選了動態規則之後角色下拉就不該還留在畫面上騙人。 */}
            <Select
              className="h-7 w-28"
              aria-label={`第${s.stepNo}關簽核人規則`}
              value={s.approverRule}
              onChange={(e) => {
                const rule = e.target.value as ApprovalStep["approverRule"]
                setSteps(
                  steps.map((x, j) =>
                    j === i
                      ? rule === "role"
                        ? {
                            ...x,
                            approverRule: rule,
                            approverRoleId: x.approverRoleId ?? roles[0]?.id,
                            approverField: undefined,
                          }
                        : rule === "fieldRef"
                          ? {
                              ...x,
                              approverRule: rule,
                              approverRoleId: undefined,
                              approverField: x.approverField ?? memberFields[0]?.name,
                            }
                          : {
                              ...x,
                              approverRule: rule,
                              approverRoleId: undefined,
                              approverField: undefined,
                            }
                      : x,
                  ),
                )
              }}
            >
              <option value="role">指定角色</option>
              <option value="fieldRef" disabled={memberFields.length === 0}>
                {memberFields.length === 0 ? "記錄上的欄位(本表沒有成員欄)" : "記錄上的欄位"}
              </option>
              <option value="manager" disabled={!hasHierarchy}>
                {hasHierarchy ? "直屬主管" : "直屬主管(尚未建立角色階層)"}
              </option>
              <option value="managerOfManager" disabled={!hasHierarchy}>
                {hasHierarchy ? "主管的主管" : "主管的主管(尚未建立角色階層)"}
              </option>
              <option value="managerOfPrevApprover" disabled={!hasHierarchy}>
                {hasHierarchy ? "前一簽核人的主管" : "前一簽核人的主管(尚未建立角色階層)"}
              </option>
            </Select>
            {s.approverRule === "role" ? (
              <Select
                className="h-7 w-24"
                aria-label={`第${s.stepNo}關簽核角色`}
                value={String(s.approverRoleId ?? "")}
                onChange={(e) =>
                  setSteps(
                    steps.map((x, j) =>
                      j === i ? { ...x, approverRoleId: Number(e.target.value) } : x,
                    ),
                  )
                }
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {s.approverRule === "fieldRef" ? (
              <Select
                className="h-7 w-24"
                aria-label={`第${s.stepNo}關簽核人欄位`}
                value={s.approverField ?? ""}
                onChange={(e) =>
                  setSteps(
                    steps.map((x, j) => (j === i ? { ...x, approverField: e.target.value } : x)),
                  )
                }
              >
                {memberFields.map((f) => (
                  <option key={f.id} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {/* 🔴 會簽門檻。三態:任一人 / 全體 / 指定人數 —— 與後端同一個欄位三種意義。
                預設「任一人」是既有行為,不因為多了這個選項就改變。 */}
            <Select
              className="h-7 w-24"
              aria-label={`第${s.stepNo}關通過條件`}
              value={s.quorum === undefined ? "any" : s.quorum === "all" ? "all" : "n"}
              onChange={(e) =>
                setSteps(
                  steps.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          quorum:
                            e.target.value === "any"
                              ? undefined
                              : e.target.value === "all"
                                ? ("all" as const)
                                : typeof x.quorum === "number"
                                  ? x.quorum
                                  : 2,
                        }
                      : x,
                  ),
                )
              }
            >
              <option value="any">任一人即可</option>
              <option value="all">全體同意(會簽)</option>
              <option value="n">指定人數(擇辦)</option>
            </Select>
            {typeof s.quorum === "number" ? (
              <Input
                className="h-7 w-14"
                type="number"
                min={1}
                aria-label={`第${s.stepNo}關需幾人同意`}
                value={String(s.quorum)}
                onChange={(e) =>
                  setSteps(
                    steps.map((x, j) =>
                      j === i ? { ...x, quorum: Math.max(1, Number(e.target.value) || 1) } : x,
                    ),
                  )
                }
              />
            ) : null}
            <Select
              className="h-7 w-20"
              value={s.amountField ?? ""}
              onChange={(e) =>
                setSteps(
                  steps.map((x, j) =>
                    j === i
                      ? e.target.value === ""
                        ? {
                            stepNo: x.stepNo,
                            approverRule: x.approverRule,
                            ...(x.approverRoleId === undefined
                              ? {}
                              : { approverRoleId: x.approverRoleId }),
                            ...(x.quorum === undefined ? {} : { quorum: x.quorum }),
                          }
                        : { ...x, amountField: e.target.value, minAmount: x.minAmount ?? 0 }
                      : x,
                  ),
                )
              }
            >
              <option value="">恆啟用</option>
              {numericFields.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}≥
                </option>
              ))}
            </Select>
            {s.amountField ? (
              <Input
                className="h-7 w-20"
                type="number"
                value={String(s.minAmount ?? 0)}
                onChange={(e) =>
                  setSteps(
                    steps.map((x, j) =>
                      j === i ? { ...x, minAmount: Number(e.target.value) || 0 } : x,
                    ),
                  )
                }
              />
            ) : null}
            <button
              type="button"
              onClick={() =>
                setSteps(steps.filter((_, j) => j !== i).map((x, j) => ({ ...x, stepNo: j + 1 })))
              }
              className="text-ink-3 hover:text-er"
              aria-label={`刪除第${s.stepNo}關`}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {/* 🔴 這句話是本功能唯一擋得住繞過的東西,所以它必須出現在**選的當下**,
            不能只留在文件裡:簽核人來自記錄上的欄位,而申請人若改得動那一欄,
            他把主管改成自己的下屬就核准了。程式擋得住「指到本人」,擋不住「指到下屬」。 */}
        {steps.some((s) => s.approverRule === "fieldRef") ? (
          <p className="text-[12px] text-warn">
            簽核人來自記錄上的欄位:請到權限頁把該欄位對申請人設為唯讀,否則申請人可以自行改掉簽核人。
          </p>
        ) : null}
        <button
          type="button"
          /* 🔴 角色還沒到之前按下去只會跳一句「請先於權限頁建立角色」——
             那句話是錯的(角色明明有,只是還在路上),而使用者會信。
             按不動比按了說謊好。 */
          disabled={rolesPending}
          onClick={addStep}
          className="flex w-fit items-center gap-1 text-[12px] text-primary hover:underline"
        >
          <Plus size={12} />
          加一關
        </button>

        {buttons.length > 0 ? (
          <Select
            className="h-7"
            value={onComplete}
            onChange={(e) => setOnComplete(e.target.value)}
          >
            <option value="">簽核完不自動執行</option>
            {buttons.map((b) => (
              <option key={b.id} value={b.id}>
                完成後執行:{b.label}
              </option>
            ))}
          </Select>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={createDef.isPending}
          className="flex items-center justify-center gap-1 rounded-xs bg-primary px-2 py-1 text-[12px] font-medium text-white hover:bg-primary-d disabled:opacity-disabled"
        >
          <Plus size={13} />
          建立流程
        </button>
        {msg !== null ? <span className="text-ink-2">{msg}</span> : null}
      </div>
    </div>
  )
}
