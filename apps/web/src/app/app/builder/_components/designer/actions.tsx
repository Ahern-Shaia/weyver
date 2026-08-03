"use client"

import { Plus, Trash2, X } from "lucide-react"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { type ReactNode, useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { useButtons, useCreateButton, useDeleteButton, useForms } from "@/lib/engine/hooks"
import type { ButtonConfig, FormDto } from "@/lib/engine/schemas"
import { LabelsPanel } from "@/app/app/builder/_components/output/labels"
import { ApprovalPanel } from "./approval-def-editor"

/* R1·後續-1 M4 設計器:表單掛自訂按鈕(動作型別 + 映射)+ 簽核定義(步驟 + 簽核角色 + 金額條件)。
   欄位映射為簡表(目標欄 ← 來源欄/固定值),對映後端封閉 allowlist config。 */
export function ActionsDesigner({
  formId,
  form,
  onClose,
}: {
  readonly formId: number
  readonly form: FormDto
  readonly onClose: () => void
}): ReactNode {
  const [tab, setTab] = useState<"buttons" | "approval" | "labels">("buttons")
  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-line bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <button
          type="button"
          onClick={() => setTab("buttons")}
          className={
            tab === "buttons"
              ? "text-[12px] font-semibold text-primary"
              : "text-[12px] text-ink-3 hover:text-ink"
          }
        >
          自訂按鈕
        </button>
        <button
          type="button"
          onClick={() => setTab("approval")}
          className={
            tab === "approval"
              ? "text-[12px] font-semibold text-primary"
              : "text-[12px] text-ink-3 hover:text-ink"
          }
        >
          簽核流程
        </button>
        <button
          type="button"
          onClick={() => setTab("labels")}
          className={
            tab === "labels"
              ? "text-[12px] font-semibold text-primary"
              : "text-[12px] text-ink-3 hover:text-ink"
          }
        >
          標籤
        </button>
        <button type="button" onClick={onClose} className="ml-auto text-ink-3 hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "buttons" ? (
          <ButtonsPanel formId={formId} form={form} />
        ) : tab === "approval" ? (
          <ApprovalPanel formId={formId} form={form} />
        ) : (
          <LabelsPanel formId={formId} form={form} />
        )}
      </div>
    </div>
  )
}

function ButtonsPanel({
  formId,
  form,
}: {
  readonly formId: number
  readonly form: FormDto
}): ReactNode {
  const { data: buttons = [] } = useButtons(formId)
  const { data: forms } = useForms()
  const createButton = useCreateButton(formId)
  const deleteButton = useDeleteButton(formId)
  const [label, setLabel] = useState("")
  const [actionType, setActionType] = useState<ButtonConfig["actionType"]>("updateSelf")
  const [targetField, setTargetField] = useState("")
  const [literal, setLiteral] = useState("")
  const [targetFormId, setTargetFormId] = useState("")
  const [sourceField, setSourceField] = useState("")
  const [url, setUrl] = useState("")
  const [msg, setMsg] = useState<string | null>(null)

  const writable = form.fields.filter(
    (f) =>
      ![
        "autoNumber",
        "formula",
        "lookup",
        "rollup",
        "createdAt",
        "createdBy",
        "updatedAt",
        "updatedBy",
      ].includes(f.type),
  )

  const submit = (): void => {
    setMsg(null)
    let config: ButtonConfig
    if (actionType === "updateSelf") {
      if (targetField === "") return setMsg("請選要設定的欄位")
      config = {
        actionType: "updateSelf",
        setFields: { [targetField]: { from: "literal", value: literal } },
      }
    } else if (actionType === "pushTo") {
      if (targetFormId === "" || targetField === "" || sourceField === "") {
        return setMsg("請選目標表單 / 目標欄 / 來源欄")
      }
      config = {
        actionType: "pushTo",
        targetFormId: Number(targetFormId),
        fieldMap: { [targetField]: { from: "field", field: sourceField } },
      }
    } else {
      if (url === "") return setMsg("請填 https 連結")
      config = { actionType: "openUrl", url }
    }
    createButton.mutate(
      { label: label.trim(), config },
      {
        onSuccess: () => {
          setLabel("")
          setMsg("已新增按鈕")
        },
        onError: (e) => setMsg(describeEngineError(e)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3 text-[12px]">
      {buttons.length > 0 ? (
        <div className="flex flex-col gap-1">
          {buttons.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-xs border border-line px-2 py-1"
            >
              <span className="truncate text-ink">{b.label}</span>
              <span className="font-mono text-[12px] text-ink-3">{b.actionType}</span>
              <button
                type="button"
                onClick={() => deleteButton.mutate(b.id)}
                className="ml-auto text-ink-3 hover:text-er"
                aria-label={`刪除 ${b.label}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-line-2 pt-2.5">
        <span className="text-ink-3">新增按鈕</span>
        <Input
          className="h-7"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="按鈕名稱"
        />
        <Select
          className="h-7"
          value={actionType}
          onChange={(e) => setActionType(e.target.value as ButtonConfig["actionType"])}
        >
          <option value="updateSelf">更新本表欄位</option>
          <option value="pushTo">資料拋轉到其他表單</option>
          <option value="openUrl">開啟連結</option>
        </Select>

        {actionType === "updateSelf" ? (
          <>
            <Select
              className="h-7"
              value={targetField}
              onChange={(e) => setTargetField(e.target.value)}
            >
              <option value="">選欄位</option>
              {writable.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Input
              className="h-7"
              value={literal}
              onChange={(e) => setLiteral(e.target.value)}
              placeholder="設定值"
            />
          </>
        ) : null}

        {actionType === "pushTo" ? (
          <>
            <Select
              className="h-7"
              value={targetFormId}
              onChange={(e) => setTargetFormId(e.target.value)}
            >
              <option value="">選目標表單</option>
              {(forms ?? [])
                .filter((f) => f.id !== formId)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </Select>
            <Input
              className="h-7"
              value={targetField}
              onChange={(e) => setTargetField(e.target.value)}
              placeholder="目標欄名"
            />
            <Select
              className="h-7"
              value={sourceField}
              onChange={(e) => setSourceField(e.target.value)}
            >
              <option value="">選來源欄(本表)</option>
              {form.fields.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        {actionType === "openUrl" ? (
          <Input
            className="h-7"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={label.trim() === "" || createButton.isPending}
          className="flex items-center justify-center gap-1 rounded-xs bg-primary px-2 py-1 text-[12px] font-medium text-white hover:bg-primary-d disabled:opacity-40"
        >
          <Plus size={13} />
          新增按鈕
        </button>
        {msg !== null ? <span className="text-ink-2">{msg}</span> : null}
      </div>
    </div>
  )
}
