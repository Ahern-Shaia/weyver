"use client"

import { describeEngineError } from "@/lib/engine/client"
import { fieldTypeMeta } from "@/lib/engine/field-types"
import { useAddField, useForm, useForms } from "@/lib/engine/hooks"
import type { CellValueType, FieldDto, FormSummary } from "@/lib/engine/schemas"
import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { StatusChip, type StatusTone } from "@weyver/ui/status-chip"
import { useState } from "react"
import { AdvancedFieldOptions } from "@/app/app/builder/_components/designer/advanced-options"
import { type ChoiceRow, ChoicesEditor, rowsToOptions } from "@/app/app/builder/_components/designer/choices-editor"
import { DesignCanvas } from "@/app/app/builder/_components/designer/canvas"
import { FieldPalette } from "@/app/app/builder/_components/designer/palette"

const STATE_TONE: Record<string, StatusTone> = {
  ready: "ok",
  pending: "warn",
  failed: "error",
}

export interface PendingField {
  type: CellValueType
  name: string
  required: boolean
  choices: ChoiceRow[]
  prefix: string
  expressionText: string
  // R1·UP-4 進階
  dateFormat: string // "" | yyyy | yyyyMM | yyyyMMdd
  resetScope: string // none | daily | monthly | yearly | field
  resetField: string
  targetFormId: string // link
  displayFields: string // link(逗號)
  linkFieldName: string // lookup
  targetFieldName: string // lookup
  lookupKeepsValue: boolean // lookup(#113):保留填單當時的內容 = snapshot
  childFormId: string // rollup
  childFieldName: string // rollup
  rollupFn: string // rollup
  grantsAccess: boolean // member(#96)
}

function splitCsv(text: string): string[] {
  return text
    .split(/[,，\n]/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
}

function pendingOptions(p: PendingField): Record<string, unknown> {
  switch (p.type) {
    case "singleSelect":
    case "multiSelect":
      return rowsToOptions(p.choices)
    case "formula":
      return { expression: p.expressionText.trim() }
    case "autoNumber": {
      const o: Record<string, unknown> = { prefix: p.prefix, resetScope: p.resetScope || "none" }
      if (p.dateFormat) o.dateFormat = p.dateFormat
      if (p.resetScope === "field" && p.resetField) o.resetField = p.resetField
      return o
    }
    case "link": {
      const o: Record<string, unknown> = { targetFormId: Number(p.targetFormId) }
      const df = splitCsv(p.displayFields)
      if (df.length > 0) o.displayFields = df
      return o
    }
    case "lookup":
      return {
        linkFieldName: p.linkFieldName,
        targetFieldName: p.targetFieldName,
        syncMode: p.lookupKeepsValue ? "snapshot" : "live",
      }
    case "rollup":
      return {
        childFormId: Number(p.childFormId),
        childFieldName: p.childFieldName,
        fn: p.rollupFn || "SUM",
      }
    /* 🔴 member 欄的存取授予(#96)。這是「業務只看自己客戶」的落地開關 ——
       打勾後,被指派到此欄的人就能存取該筆記錄(RLS record_scope 政策讀 assignees)。 */
    case "member":
      return p.grantsAccess ? { grantsAccess: true } : {}
    case "barcode":
      return { symbology: "qr" }
    default:
      return {}
  }
}

export function EditFormPanel({
  formId,
  onAddSubtable,
}: {
  formId: number
  onAddSubtable: (parentFormId: number, parentName: string) => void
}) {
  const formQuery = useForm(formId)
  const { data: forms } = useForms()
  const addField = useAddField(formId)

  const [pending, setPending] = useState<PendingField | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (formQuery.isLoading) {
    return <div className="p-6 text-[12px] text-ink-3">載入中…</div>
  }
  if (formQuery.isError || formQuery.data === undefined) {
    return (
      <div className="p-6 text-[13px] text-er">載入失敗:{describeEngineError(formQuery.error)}</div>
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
      choices: meta.needsChoices
        ? [
            { name: "選項一", tone: "c1" as const },
            { name: "選項二", tone: "c2" as const },
          ]
        : [],
      prefix: type === "autoNumber" ? "NO-" : "",
      expressionText: "",
      dateFormat: "",
      resetScope: "none",
      resetField: "",
      targetFormId: "",
      displayFields: "",
      linkFieldName: "",
      targetFieldName: "",
      childFormId: "",
      childFieldName: "",
      rollupFn: "SUM",
      grantsAccess: false,
      /* 建議值 = 保留當時內容。業界多數(Ragic / FileMaker / Dataverse / SAP)皆為快照;
         全 live 那一派的社群長年抱怨「改個主檔,去年的單據跟著變」。 */
      lookupKeepsValue: true,
    })
  }

  const confirmAdd = () => {
    if (pending === null) return
    if (pending.name.trim().length === 0) {
      setError("欄位名稱不可空白")
      return
    }
    if (pending.type === "formula" && pending.expressionText.trim() === "") {
      setError("公式欄需輸入公式(如 {單價} * {數量})")
      return
    }
    if (pending.type === "link" && pending.targetFormId === "") {
      setError("關聯欄需選擇目標表單")
      return
    }
    if (
      pending.type === "lookup" &&
      (pending.linkFieldName === "" || pending.targetFieldName.trim() === "")
    ) {
      setError("帶入欄需選關聯欄 + 填目標欄名")
      return
    }
    if (
      pending.type === "rollup" &&
      (pending.childFormId === "" || pending.childFieldName.trim() === "")
    ) {
      setError("彙總欄需選子表 + 填子表欄名")
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
      <FieldPalette onPick={startAdd} disabled={form.provisionState !== "ready"} advanced />

      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-card px-4 py-2.5">
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">{form.name}</h1>
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
          <div className="shrink-0 border-b border-er-line bg-er-t px-4 py-2 text-[14px] text-er">
            {error}
          </div>
        ) : null}
        {pending !== null ? (
          <div className="shrink-0 border-b border-line px-4 py-2">
            <PendingEditor
              pending={pending}
              currentFields={fields}
              forms={forms ?? []}
              formId={formId}
              onChange={setPending}
              onConfirm={confirmAdd}
              onCancel={() => setPending(null)}
              busy={addField.isPending}
            />
          </div>
        ) : null}

        {form.provisionState === "failed" ? (
          <p className="shrink-0 px-4 py-2 text-[13px] text-er">
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
  currentFields,
  forms,
  formId,
  onChange,
  onConfirm,
  onCancel,
  busy,
}: {
  pending: PendingField
  currentFields: readonly FieldDto[]
  forms: readonly FormSummary[]
  formId: number
  onChange: (next: PendingField) => void
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  const meta = fieldTypeMeta(pending.type)
  const set = (patch: Partial<PendingField>) => onChange({ ...pending, ...patch })
  const t = pending.type
  const subtables = forms.filter((f) => f.parentFormId === formId)

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
        onChange={(e) => set({ name: e.target.value })}
        placeholder="欄位名稱"
      />
      <label className="flex items-center gap-1.5 text-[11px] text-ink-2">
        <input
          type="checkbox"
          checked={pending.required}
          onChange={(e) => set({ required: e.target.checked })}
          className="accent-(--color-primary)"
        />
        必填
      </label>

      {t === "singleSelect" || t === "multiSelect" ? (
        <ChoicesEditor rows={pending.choices} onChange={(choices) => set({ choices })} />
      ) : null}
      {t === "formula" ? (
        <Input
          value={pending.expressionText}
          onChange={(e) => set({ expressionText: e.target.value })}
          placeholder="公式,如 {單價} * {數量}"
          className="font-mono"
        />
      ) : null}

      <AdvancedFieldOptions
        pending={pending}
        set={set}
        forms={forms}
        subtables={subtables}
        currentFields={currentFields}
      />
    </div>
  )
}
