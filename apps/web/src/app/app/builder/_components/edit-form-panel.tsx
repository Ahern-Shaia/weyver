"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { Select } from "@weyver/ui/select"
import { StatusChip, type StatusTone } from "@weyver/ui/status-chip"
import { useState } from "react"
import { describeEngineError } from "@/lib/engine/client"
import { fieldTypeMeta } from "@/lib/engine/field-types"
import { useAddField, useForm, useForms } from "@/lib/engine/hooks"
import type { CellValueType, FieldDto, FormSummary } from "@/lib/engine/schemas"
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
  // R1·UP-4 進階
  dateFormat: string // "" | yyyy | yyyyMM | yyyyMMdd
  resetScope: string // none | daily | monthly | yearly | field
  resetField: string
  targetFormId: string // link
  displayFields: string // link(逗號)
  linkFieldName: string // lookup
  targetFieldName: string // lookup
  childFormId: string // rollup
  childFieldName: string // rollup
  rollupFn: string // rollup
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
      return { choices: splitCsv(p.choicesText) }
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
      return { linkFieldName: p.linkFieldName, targetFieldName: p.targetFieldName }
    case "rollup":
      return {
        childFormId: Number(p.childFormId),
        childFieldName: p.childFieldName,
        fn: p.rollupFn || "SUM",
      }
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
  const linkFields = currentFields.filter((f) => f.type === "link")
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
        <Input
          value={pending.choicesText}
          onChange={(e) => set({ choicesText: e.target.value })}
          placeholder="選項以逗號分隔"
        />
      ) : null}
      {t === "formula" ? (
        <Input
          value={pending.expressionText}
          onChange={(e) => set({ expressionText: e.target.value })}
          placeholder="公式,如 {單價} * {數量}"
          className="font-mono"
        />
      ) : null}

      {t === "autoNumber" ? (
        <div className="flex flex-wrap gap-2">
          <Input
            value={pending.prefix}
            onChange={(e) => set({ prefix: e.target.value })}
            placeholder="前綴,如 PO-"
            className="w-28"
          />
          <Select
            className="h-7"
            value={pending.dateFormat}
            onChange={(e) => set({ dateFormat: e.target.value })}
          >
            <option value="">無日期段</option>
            <option value="yyyy">yyyy</option>
            <option value="yyyyMM">yyyyMM</option>
            <option value="yyyyMMdd">yyyyMMdd</option>
          </Select>
          <Select
            className="h-7"
            value={pending.resetScope}
            onChange={(e) => set({ resetScope: e.target.value })}
          >
            <option value="none">不重設</option>
            <option value="daily">每日重設</option>
            <option value="monthly">每月重設</option>
            <option value="yearly">每年重設</option>
            <option value="field">依欄位重設</option>
          </Select>
          {pending.resetScope === "field" ? (
            <Select
              className="h-7"
              value={pending.resetField}
              onChange={(e) => set({ resetField: e.target.value })}
            >
              <option value="">選重設依據欄</option>
              {currentFields.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      ) : null}

      {t === "link" ? (
        <div className="flex flex-wrap gap-2">
          <Select
            className="h-7"
            value={pending.targetFormId}
            onChange={(e) => set({ targetFormId: e.target.value })}
          >
            <option value="">選目標表單</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <Input
            value={pending.displayFields}
            onChange={(e) => set({ displayFields: e.target.value })}
            placeholder="顯示欄(逗號,選填)"
            className="w-44"
          />
        </div>
      ) : null}

      {t === "lookup" ? (
        <div className="flex flex-wrap gap-2">
          <Select
            className="h-7"
            value={pending.linkFieldName}
            onChange={(e) => set({ linkFieldName: e.target.value })}
          >
            <option value="">選關聯欄</option>
            {linkFields.map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
          </Select>
          <Input
            value={pending.targetFieldName}
            onChange={(e) => set({ targetFieldName: e.target.value })}
            placeholder="目標欄名"
            className="w-32"
          />
          {linkFields.length === 0 ? (
            <span className="text-[10.5px] text-ink-4">需先加關聯欄</span>
          ) : null}
        </div>
      ) : null}

      {t === "rollup" ? (
        <div className="flex flex-wrap gap-2">
          <Select
            className="h-7"
            value={pending.childFormId}
            onChange={(e) => set({ childFormId: e.target.value })}
          >
            <option value="">選子表</option>
            {subtables.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <Input
            value={pending.childFieldName}
            onChange={(e) => set({ childFieldName: e.target.value })}
            placeholder="子表欄名"
            className="w-28"
          />
          <Select
            className="h-7"
            value={pending.rollupFn}
            onChange={(e) => set({ rollupFn: e.target.value })}
          >
            <option value="SUM">加總</option>
            <option value="COUNT">計數</option>
            <option value="AVERAGE">平均</option>
            <option value="MIN">最小</option>
            <option value="MAX">最大</option>
          </Select>
          {subtables.length === 0 ? (
            <span className="text-[10.5px] text-ink-4">需先加子表</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
