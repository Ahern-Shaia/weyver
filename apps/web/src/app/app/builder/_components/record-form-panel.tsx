"use client"

import { Button } from "@weyver/ui/button"
import { cn } from "@weyver/ui/lib/utils"
import { useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { isStubType } from "@/lib/engine/field-types"
import { useCreateRecord, useForm } from "@/lib/engine/hooks"
import type { FieldDto } from "@/lib/engine/schemas"
import { FieldInput } from "./field-input"
import { toSubmitValue } from "./field-value"

export function RecordFormPanel({ formId }: { formId: number }) {
  const formQuery = useForm(formId)
  const createRecord = useCreateRecord(formId)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [savedNo, setSavedNo] = useState<string | null>(null)

  if (formQuery.isLoading) return <div className="p-6 text-[12px] text-ink-3">載入中…</div>
  if (formQuery.data === undefined) {
    return <div className="p-6 text-[12px] text-er">載入失敗</div>
  }
  const form = formQuery.data
  const editable = form.fields.filter((f) => !isStubType(f.type))

  const set = (name: string, value: unknown) => setValues((prev) => ({ ...prev, [name]: value }))

  const submit = () => {
    // 前端基本驗證:required 非空(後端為權威,422 補精確訊息)
    for (const field of editable) {
      if (!field.required || field.type === "autoNumber") continue
      const submitted = toSubmitValue(field, values[field.name])
      if (submitted === undefined || submitted === null || submitted === "") {
        setError(`「${field.name}」為必填`)
        return
      }
    }
    const payload: Record<string, unknown> = {}
    for (const field of editable) {
      const submitted = toSubmitValue(field, values[field.name])
      if (submitted !== undefined) payload[field.name] = submitted
    }
    setError(null)
    createRecord.mutate(payload, {
      onSuccess: (record) => {
        setValues({})
        const auto = form.fields.find((f) => f.type === "autoNumber")
        setSavedNo(
          auto !== undefined ? String(record.values[auto.name] ?? record.id) : String(record.id),
        )
      },
      onError: (e) => {
        setSavedNo(null)
        setError(describeEngineError(e))
      },
    })
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface py-4">
      <div className="mx-auto max-w-[720px] px-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[13px] font-semibold">新增{form.name}</span>
          <div className="ml-auto flex gap-1.5">
            <Button onClick={() => setValues({})}>清除</Button>
            <Button variant="primary" onClick={submit} disabled={createRecord.isPending}>
              {createRecord.isPending ? "儲存中…" : "儲存"}
            </Button>
          </div>
        </div>

        {savedNo !== null ? (
          <div className="mb-3 border border-ok-line bg-ok-t px-3 py-2 text-[12px] text-ok">
            已儲存:<b className="font-mono">{savedNo}</b>(可於「資料」檢視)
          </div>
        ) : null}
        {error !== null ? (
          <div className="mb-3 border border-er-line bg-er-t px-3 py-2 text-[12px] text-er">
            {error}
          </div>
        ) : null}

        <section className="border border-line bg-card">
          <header className="bg-primary px-3 py-1.5 text-[12px] font-semibold text-white">
            填寫
          </header>
          <div className="grid grid-cols-[128px_1fr]">
            {form.fields.map((field, index) => {
              const isLast = index === form.fields.length - 1
              return (
                <FieldRow key={field.id} field={field} isLast={isLast}>
                  <FieldInput
                    field={field}
                    value={values[field.name]}
                    onChange={(v) => set(field.name, v)}
                  />
                </FieldRow>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function FieldRow({
  field,
  isLast,
  children,
}: {
  field: FieldDto
  isLast: boolean
  children: React.ReactNode
}) {
  return (
    <>
      <div
        className={cn(
          "flex min-h-[34px] items-center justify-end gap-1 border-r border-cell bg-label px-2.5 text-right text-[11.5px] text-ink-2",
          !isLast && "border-b",
        )}
      >
        {field.required ? <span className="font-semibold text-er">*</span> : null}
        {field.name}
      </div>
      <div
        className={cn(
          "flex min-h-[34px] items-center px-2.5 py-1",
          !isLast && "border-b border-cell",
        )}
      >
        {children}
      </div>
    </>
  )
}
