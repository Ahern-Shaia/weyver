"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { StatusChip, type StatusTone } from "@weyver/ui/status-chip"
import { cn } from "@weyver/ui/lib/utils"
import { useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { conversionTargets, fieldTypeMeta, isStubType } from "@/lib/engine/field-types"
import {
  useAddField,
  useAlterFieldType,
  useDropField,
  useForm,
  useMoveField,
} from "@/lib/engine/hooks"
import type { CellValueType, FieldDto } from "@/lib/engine/schemas"
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
  const alterType = useAlterFieldType(formId)
  const dropField = useDropField(formId)
  const moveField = useMoveField(formId)

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
    })
  }

  const confirmAdd = () => {
    if (pending === null) return
    if (pending.name.trim().length === 0) {
      setError("欄位名稱不可空白")
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

      <div className="min-w-0 flex-1 overflow-y-auto bg-surface p-4">
        <div className="mx-auto max-w-[720px]">
          <div className="mb-3 flex items-baseline gap-2 border border-b-0 border-line bg-card px-4 py-3">
            <h1 className="text-base font-semibold tracking-tight">{form.name}</h1>
            <StatusChip tone={STATE_TONE[form.provisionState] ?? "neutral"}>
              {form.provisionState}
            </StatusChip>
            <span className="ml-auto font-mono text-[11px] text-ink-3">
              v{form.version} · {fields.length} 欄{form.parentFormId !== null ? " · 子表" : ""}
            </span>
            {form.parentFormId === null ? (
              <Button onClick={() => onAddSubtable(form.id, form.name)}>＋ 加子表</Button>
            ) : null}
          </div>

          {error !== null ? (
            <div className="mb-3 border border-er-line bg-er-t px-3 py-2 text-[12px] text-er">
              {error}
            </div>
          ) : null}

          {pending !== null ? (
            <PendingEditor
              pending={pending}
              onChange={setPending}
              onConfirm={confirmAdd}
              onCancel={() => setPending(null)}
              busy={addField.isPending}
            />
          ) : null}

          <section className="border border-line bg-card">
            <header className="bg-primary px-3 py-1.5 text-[12px] font-semibold text-white">
              欄位
            </header>
            <ul>
              {fields.map((field, index) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  isFirst={index === 0}
                  isLast={index === fields.length - 1}
                  onMove={(direction) => moveField.mutate({ fieldId: field.id, direction })}
                  onAlterType={(type) => alterType.mutate({ fieldId: field.id, type })}
                  onDrop={() => dropField.mutate(field.id)}
                />
              ))}
            </ul>
          </section>
          {form.provisionState === "failed" ? (
            <p className="mt-2 text-[11px] text-er">此表單建置失敗,無法編輯(見 API ddl_audit)。</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function FieldRow({
  field,
  isFirst,
  isLast,
  onMove,
  onAlterType,
  onDrop,
}: {
  field: FieldDto
  isFirst: boolean
  isLast: boolean
  onMove: (direction: "up" | "down") => void
  onAlterType: (type: CellValueType) => void
  onDrop: () => void
}) {
  const meta = fieldTypeMeta(field.type)
  const targets = conversionTargets(field.type)
  return (
    <li className={cn("flex items-center gap-2 px-2.5 py-2", !isLast && "border-b border-cell")}>
      <span className="inline-flex h-4 w-5 shrink-0 items-center justify-center rounded-xs bg-label font-mono text-[9.5px] font-semibold text-ink-3">
        {meta.mark}
      </span>
      <span className="flex-1 text-[12px] text-ink">
        {field.required ? <span className="mr-0.5 font-semibold text-er">*</span> : null}
        {field.name}
        {isStubType(field.type) ? (
          <span className="ml-1 text-[10px] text-ink-4">(即將推出)</span>
        ) : null}
      </span>
      <span className="w-16 shrink-0 text-[10.5px] text-ink-3">{meta.label}</span>
      {targets.length > 0 ? (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value !== "") onAlterType(e.target.value as CellValueType)
          }}
          className="h-[27px] shrink-0 rounded-xs border border-line bg-card px-1 text-[11px]"
          aria-label={`改 ${field.name} 型別`}
        >
          <option value="">改型別…</option>
          {targets.map((t) => (
            <option key={t} value={t}>
              → {fieldTypeMeta(t).label}
            </option>
          ))}
        </select>
      ) : null}
      <div className="flex shrink-0 gap-1">
        <Button onClick={() => onMove("up")} disabled={isFirst}>
          ↑
        </Button>
        <Button onClick={() => onMove("down")} disabled={isLast}>
          ↓
        </Button>
        <Button variant="danger" onClick={onDrop}>
          下架
        </Button>
      </div>
    </li>
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
    <div className="mb-3 flex flex-col gap-2 border border-primary bg-primary-t p-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-ink-2">加入{meta.label}欄位</span>
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
    </div>
  )
}
