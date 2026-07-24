"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { StatusChip, type StatusTone } from "@weyver/ui/status-chip"
import { useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { fieldTypeMeta } from "@/lib/engine/field-types"
import { useAddField, useForm } from "@/lib/engine/hooks"
import type { CellValueType } from "@/lib/engine/schemas"
import { DesignCanvas } from "./design-canvas"
import { FieldPalette } from "./field-palette"

const STATE_TONE: Record<string, StatusTone> = {
  ready: "ok",
  pending: "warn",
  failed: "error",
}

interface PendingField {
  type: CellValueType
  name: string
  required: boolean
  choicesText: string
  prefix: string
  expressionText: string
}

function pendingOptions(pending: PendingField): Record<string, unknown> {
  const meta = fieldTypeMeta(pending.type)
  if (meta.needsChoices) {
    return {
      choices: pending.choicesText
        .split(/[,，\n]/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0),
    }
  }
  if (meta.needsPrefix) return { prefix: pending.prefix }
  if (meta.needsExpression) return { expression: pending.expressionText.trim() }
  return {}
}

export function EditFormPanel({
  formId,
  onAddSubtable,
}: {
  formId: number
  onAddSubtable: (parentFormId: number, parentName: string) => void
}) {
  const formQuery = useForm(formId)
  const addField = useAddField(formId)

  const [pending, setPending] = useState<PendingField | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (formQuery.isLoading) {
    return <div className="p-6 text-[12px] text-ink-3">載入中…</div>
  }
  if (formQuery.isError || formQuery.data === undefined) {
    return (
      <div className="p-6 text-[12px] text-er">載入失敗:{describeEngineError(formQuery.error)}</div>
    )
  }
  const form = formQuery.data
  const fields = form.fields

  const startAdd = (type: CellValueType) => {
    const meta = fieldTypeMeta(type)
    setError(null)
    setPending({
      type,
      name: "",
      required: false,
      choicesText: meta.needsChoices ? "選項一, 選項二" : "",
      prefix: type === "autoNumber" ? "NO-" : "",
      expressionText: "",
    })
  }

  const confirmAdd = () => {
    if (pending === null) return
    if (pending.name.trim().length === 0) {
      setError("欄位名稱不可空白")
      return
    }
    if (fieldTypeMeta(pending.type).needsExpression && pending.expressionText.trim() === "") {
      setError("公式欄需輸入公式(如 {單價} * {數量})")
      return
    }
    addField.mutate(
      {
        name: pending.name.trim(),
        type: pending.type,
        required: pending.required,
        options: pendingOptions(pending),
      },
      {
        onSuccess: () => setPending(null),
        onError: (e) => setError(describeEngineError(e)),
      },
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <FieldPalette onPick={startAdd} disabled={form.provisionState !== "ready"} />

      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-card px-4 py-2.5">
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">{form.name}</h1>
          <StatusChip tone={STATE_TONE[form.provisionState] ?? "neutral"}>
            {form.provisionState}
          </StatusChip>
          <span className="ml-auto font-mono text-[11px] text-ink-4">
            v{form.version} · {fields.length} 欄{form.parentFormId !== null ? " · 子表" : ""}
          </span>
          {form.parentFormId === null ? (
            <Button onClick={() => onAddSubtable(form.id, form.name)}>＋ 加子表</Button>
          ) : null}
        </div>

        {error !== null ? (
          <div className="shrink-0 border-b border-er-line bg-er-t px-4 py-2 text-[12px] text-er">
            {error}
          </div>
        ) : null}
        {pending !== null ? (
          <div className="shrink-0 border-b border-line px-4 py-2">
            <PendingEditor
              pending={pending}
              onChange={setPending}
              onConfirm={confirmAdd}
              onCancel={() => setPending(null)}
              busy={addField.isPending}
            />
          </div>
        ) : null}

        {form.provisionState === "failed" ? (
          <p className="shrink-0 px-4 py-2 text-[11px] text-er">
            此表單建置失敗,無法編輯(見 API ddl_audit)。
          </p>
        ) : (
          <DesignCanvas formId={formId} form={form} />
        )}
      </div>
    </div>
  )
}

function PendingEditor({
  pending,
  onChange,
  onConfirm,
  onCancel,
  busy,
}: {
  pending: PendingField
  onChange: (next: PendingField) => void
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  const meta = fieldTypeMeta(pending.type)
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-md border border-primary/50 bg-primary-t p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-primary">加入{meta.label}欄位</span>
        <div className="ml-auto flex gap-1.5">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? "加入中…" : "加入"}
          </Button>
        </div>
      </div>
      <Input
        value={pending.name}
        onChange={(e) => onChange({ ...pending, name: e.target.value })}
        placeholder="欄位名稱"
      />
      <label className="flex items-center gap-1.5 text-[11px] text-ink-2">
        <input
          type="checkbox"
          checked={pending.required}
          onChange={(e) => onChange({ ...pending, required: e.target.checked })}
          className="accent-(--color-primary)"
        />
        必填
      </label>
      {meta.needsChoices ? (
        <Input
          value={pending.choicesText}
          onChange={(e) => onChange({ ...pending, choicesText: e.target.value })}
          placeholder="選項以逗號分隔"
        />
      ) : null}
      {meta.needsPrefix ? (
        <Input
          value={pending.prefix}
          onChange={(e) => onChange({ ...pending, prefix: e.target.value })}
          placeholder="編號前綴,如 PO-"
          className="w-40"
        />
      ) : null}
      {meta.needsExpression ? (
        <Input
          value={pending.expressionText}
          onChange={(e) => onChange({ ...pending, expressionText: e.target.value })}
          placeholder="公式,如 {單價} * {數量}"
          className="font-mono"
        />
      ) : null}
    </div>
  )
}
