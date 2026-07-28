"use client"

import { describeEngineError } from "@/lib/engine/client"
import { fieldTypeMeta } from "@/lib/engine/field-types"
import { useCreateForm } from "@/lib/engine/hooks"
import type { CellValueType, CreateFormInput } from "@/lib/engine/schemas"
import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { cn } from "@weyver/ui/lib/utils"
import { useState } from "react"
import { type ChoiceRow, ChoicesEditor, rowsToOptions } from "./choices-editor"
import { FieldPalette } from "./field-palette"

interface DraftField {
  readonly key: string
  name: string
  type: CellValueType
  required: boolean
  choices: ChoiceRow[] // singleSelect / multiSelect
  prefix: string // autoNumber
  expressionText: string // formula
}

let draftSeq = 0

function newDraftField(type: CellValueType): DraftField {
  const meta = fieldTypeMeta(type)
  return {
    key: `d${draftSeq++}`,
    name: `新${meta.label}`,
    type,
    required: false,
    choices: meta.needsChoices
      ? [
          { name: "選項一", tone: "c1" as const },
          { name: "選項二", tone: "c2" as const },
        ]
      : [],
    prefix: type === "autoNumber" ? "NO-" : "",
    expressionText: "",
  }
}

function buildOptions(field: DraftField): Record<string, unknown> {
  const meta = fieldTypeMeta(field.type)
  if (meta.needsChoices) return rowsToOptions(field.choices)
  if (meta.needsPrefix) return { prefix: field.prefix }
  if (meta.needsExpression) return { expression: field.expressionText.trim() }
  return {}
}

export function NewFormPanel({
  onCreated,
  onCancel,
  parentFormId,
  parentName,
}: {
  onCreated: (formId: number) => void
  onCancel: () => void
  parentFormId?: number | undefined
  parentName?: string | undefined
}) {
  const [name, setName] = useState("")
  const [fields, setFields] = useState<DraftField[]>([])
  const [error, setError] = useState<string | null>(null)
  const createForm = useCreateForm()

  const patch = (key: string, next: Partial<DraftField>) =>
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...next } : f)))
  const remove = (key: string) => setFields((prev) => prev.filter((f) => f.key !== key))
  const move = (key: string, dir: -1 | 1) =>
    setFields((prev) => {
      const i = prev.findIndex((f) => f.key === key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const a = next[i]
      const b = next[j]
      if (a === undefined || b === undefined) return prev
      next[i] = b
      next[j] = a
      return next
    })

  const validate = (): string | null => {
    if (name.trim().length === 0) return "請輸入表單名稱"
    if (fields.length === 0) return "請至少加入一個欄位"
    const seen = new Set<string>()
    for (const f of fields) {
      const n = f.name.trim()
      if (n.length === 0) return "欄位名稱不可空白"
      if (seen.has(n)) return `欄位名稱重複:${n}`
      seen.add(n)
      if (fieldTypeMeta(f.type).needsChoices && buildOptions(f).choices instanceof Array) {
        if ((buildOptions(f).choices as string[]).length === 0) return `「${n}」需至少一個選項`
      }
      if (fieldTypeMeta(f.type).needsExpression && f.expressionText.trim() === "") {
        return `「${n}」需輸入公式(如 {單價} * {數量})`
      }
    }
    return null
  }

  const publish = () => {
    const message = validate()
    if (message !== null) {
      setError(message)
      return
    }
    setError(null)
    const input: CreateFormInput = {
      name: name.trim(),
      ...(parentFormId !== undefined ? { parentFormId } : {}),
      fields: fields.map((f) => ({
        name: f.name.trim(),
        type: f.type,
        required: f.required,
        options: buildOptions(f),
      })),
    }
    createForm.mutate(input, {
      onSuccess: (form) => onCreated(form.id),
      onError: (e) => setError(describeEngineError(e)),
    })
  }

  return (
    <div className="flex h-full min-h-0">
      <FieldPalette onPick={(type) => setFields((prev) => [...prev, newDraftField(type)])} />

      <div className="min-w-0 flex-1 overflow-y-auto bg-surface p-4">
        <div className="mx-auto max-w-[680px]">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] text-ink-3">
              {parentFormId !== undefined
                ? `新子表(明細 · 隸屬「${parentName ?? ""}」)`
                : "新表單(草稿 · 發布後生成資料表)"}
            </span>
            <div className="ml-auto flex gap-1.5">
              <Button onClick={onCancel}>取消</Button>
              <Button variant="primary" onClick={publish} disabled={createForm.isPending}>
                {createForm.isPending ? "發布中…" : "發布表單"}
              </Button>
            </div>
          </div>

          <label className="mb-3 flex flex-col gap-1 text-[11px] text-ink-2">
            表單名稱
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如:採購單" />
          </label>

          {error !== null ? (
            <div className="mb-3 border border-er-line bg-er-t px-3 py-2 text-[12px] text-er">
              {error}
            </div>
          ) : null}

          <section className="border border-line bg-card">
            <header className="bg-primary px-3 py-1.5 text-[12px] font-semibold text-white">
              欄位({fields.length})
            </header>
            {fields.length === 0 ? (
              <div className="p-6 text-center text-[11.5px] text-ink-4">從左側點擊欄位型別加入</div>
            ) : (
              <ul>
                {fields.map((f, index) => {
                  const meta = fieldTypeMeta(f.type)
                  const isLast = index === fields.length - 1
                  return (
                    <li
                      key={f.key}
                      className={cn("flex flex-col gap-2 p-2.5", !isLast && "border-b border-cell")}
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-4 w-5 shrink-0 items-center justify-center rounded-xs bg-label font-mono text-[9.5px] font-semibold text-ink-3">
                          {meta.mark}
                        </span>
                        <Input
                          value={f.name}
                          onChange={(e) => patch(f.key, { name: e.target.value })}
                          className="flex-1"
                        />
                        <span className="w-16 shrink-0 text-[10.5px] text-ink-3">{meta.label}</span>
                        <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2">
                          <input
                            type="checkbox"
                            checked={f.required}
                            onChange={(e) => patch(f.key, { required: e.target.checked })}
                            className="accent-(--color-primary)"
                          />
                          必填
                        </label>
                        <div className="flex shrink-0 gap-1">
                          <Button onClick={() => move(f.key, -1)} disabled={index === 0}>
                            ↑
                          </Button>
                          <Button onClick={() => move(f.key, 1)} disabled={isLast}>
                            ↓
                          </Button>
                          <Button variant="danger" onClick={() => remove(f.key)}>
                            刪
                          </Button>
                        </div>
                      </div>
                      {meta.needsChoices ? (
                        <div className="ml-7">
                          <ChoicesEditor
                            rows={f.choices}
                            onChange={(choices) => patch(f.key, { choices })}
                          />
                        </div>
                      ) : null}
                      {meta.needsPrefix ? (
                        <Input
                          value={f.prefix}
                          onChange={(e) => patch(f.key, { prefix: e.target.value })}
                          placeholder="編號前綴,如 PO-"
                          className="ml-7 w-40"
                        />
                      ) : null}
                      {meta.needsExpression ? (
                        <Input
                          value={f.expressionText}
                          onChange={(e) => patch(f.key, { expressionText: e.target.value })}
                          placeholder="公式,如 {單價} * {數量}"
                          className="ml-7 font-mono"
                        />
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
