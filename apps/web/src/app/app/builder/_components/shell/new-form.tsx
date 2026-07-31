"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Table2 } from "lucide-react"
import { type ReactNode, useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { useCreateForm } from "@/lib/engine/hooks"

/* 🔴 建表 = 命名 → 直接進該表單的設計模式(#109,對齊 Ragic doc/37)。

   **原本是自創的兩套 UI**:新建有一套「先把欄位排好再送出」的流程,
   既有表單另有設計器。兩套的欄位設定能力必然漂移(新建那套就少了型別轉換、
   選項編輯、2D 版面),而使用者要學兩次。
   Ragic 的新建與既有是**同一個設計器**,新建只是「空白畫布 + 一個名字」。

   子表單同理 —— 只是多帶一個 parentFormId。 */
export function NewFormPanel({
  onCreated,
  onCancel,
  parentFormId,
  parentName,
}: {
  readonly onCreated: (formId: number) => void
  readonly onCancel: () => void
  readonly parentFormId?: number | undefined
  readonly parentName?: string | undefined
}): ReactNode {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const createForm = useCreateForm()

  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed === "") {
      setError("請輸入表單名稱")
      return
    }
    setError(null)
    createForm.mutate(
      {
        name: trimmed,
        // 空白表單 —— 欄位一律在設計器裡加,不在這裡先排一次
        fields: [],
        ...(parentFormId === undefined ? {} : { parentFormId }),
      },
      {
        onSuccess: (form) => onCreated(form.id),
        onError: (e) => setError(describeEngineError(e)),
      },
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface p-8">
      <div className="w-full max-w-[380px]">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-md border border-line bg-card text-ink-3">
          <Table2 size={22} strokeWidth={1.5} />
        </div>
        <h2 className="text-center text-[15px] font-semibold text-ink">
          {parentName === undefined ? "新增表單" : `為「${parentName}」新增子表`}
        </h2>
        <p className="mt-1.5 text-center text-[12px] leading-relaxed text-ink-3">
          先取個名字,接著在設計器裡加欄位。
        </p>

        {error !== null ? (
          <div className="mt-3 border border-er/40 bg-er/5 px-3 py-2 text-[14px] text-er">
            {error}
          </div>
        ) : null}

        <label className="mt-4 flex flex-col gap-1 text-[11px] text-ink-2">
          表單名稱
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
            }}
            placeholder={parentName === undefined ? "如:採購單" : "如:採購明細"}
          />
        </label>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={createForm.isPending}>
            {createForm.isPending ? "建立中…" : "建立並開始設計"}
          </Button>
        </div>
      </div>
    </div>
  )
}
