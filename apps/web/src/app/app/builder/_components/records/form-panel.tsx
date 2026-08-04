"use client"

import { FieldInput } from "@/components/form/field-input"
import { useGridKeyboard } from "@/components/form/use-grid-keyboard"
import { formatFieldValue, toSubmitValue } from "@/components/form/value"
import { describeEngineError } from "@/lib/engine/client"
import { isStubType } from "@/lib/engine/field-types"
import { type FormulaFieldSpec, computeFormulaPreview } from "@/lib/engine/formula-preview"
import { useCreateRecord, useForm, useForms, useLayout, useSaveWithLines } from "@/lib/engine/hooks"
import { useDisplayCtx } from "@/lib/engine/use-settings"
import type { FieldDto } from "@/lib/engine/schemas"
import { toText } from "@weyver/formula"
import { Button } from "@weyver/ui/button"
import { Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { HeaderFields } from "./header-fields"

/* 公式欄即時預覽:以填單當前值 client 端算(與後端同引擎);循環 / 錯誤時各欄回 —,不炸整表 */
function computeHeaderPreview(
  fields: readonly FieldDto[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const specs: FormulaFieldSpec[] = fields
    .filter((f) => f.type === "formula")
    .map((f) => ({ name: f.name, expr: String(f.options.expression ?? "") }))
  if (specs.length === 0) return {}
  try {
    const computed = computeFormulaPreview(specs, values)
    const out: Record<string, unknown> = {}
    for (const [name, v] of Object.entries(computed)) out[name] = toText(v)
    return out
  } catch {
    return {}
  }
}

interface LineDraft {
  readonly key: string
  values: Record<string, unknown>
}

let lineSeq = 0

export function RecordFormPanel({ formId }: { formId: number }) {
  const formQuery = useForm(formId)
  const fmtCtx = useDisplayCtx()
  /* 填單吃設計器排的版面(UP-3c M1);沒有版面時 effectiveLayout 會給預設半寬順排 */
  const layoutQuery = useLayout(formId)
  const formsQuery = useForms()
  const createRecord = useCreateRecord(formId)
  const saveWithLines = useSaveWithLines(formId)

  const childForm = useMemo(
    () => formsQuery.data?.find((f) => f.parentFormId === formId) ?? null,
    [formsQuery.data, formId],
  )
  const childQuery = useForm(childForm?.id ?? null)

  const [values, setValues] = useState<Record<string, unknown>>({})
  const [lines, setLines] = useState<LineDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savedNo, setSavedNo] = useState<string | null>(null)

  /* 🔴 Hook 必須在任何 early return **之前**呼叫(Rules of Hooks)。
     子表列數/欄數於資料未到時為 0,不影響正確性;放到 return 之後會讓
     載入狀態切換時 hook 呼叫順序改變而崩潰(M5 首版即誤置,由 build 的 lint 抓到)。 */
  const childFieldCount = childQuery.data?.fields.length ?? 0
  const grid = useGridKeyboard(lines.length, childFieldCount)

  if (formQuery.isLoading) return <div className="p-6 text-[13px] text-ink-3">載入中…</div>
  if (formQuery.data === undefined) {
    return <div className="p-6 text-[13px] text-er">載入失敗</div>
  }
  const form = formQuery.data
  const headerPreview = computeHeaderPreview(form.fields, values)
  const hasChild = childForm !== null
  const childFields = childQuery.data?.fields ?? []
  const pending = createRecord.isPending || saveWithLines.isPending

  const set = (name: string, value: unknown) => setValues((prev) => ({ ...prev, [name]: value }))
  const addLine = () => setLines((prev) => [...prev, { key: `l${lineSeq++}`, values: {} }])
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key))
  const patchLine = (key: string, name: string, value: unknown) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, values: { ...l.values, [name]: value } } : l)),
    )

  const missingRequired = (
    fields: readonly FieldDto[],
    src: Record<string, unknown>,
  ): string | null => {
    for (const field of fields) {
      if (!field.required || field.type === "autoNumber" || isStubType(field.type)) continue
      const v = toSubmitValue(field, src[field.name])
      if (v === undefined || v === null || v === "") return field.name
    }
    return null
  }

  const buildPayload = (fields: readonly FieldDto[], src: Record<string, unknown>) => {
    const payload: Record<string, unknown> = {}
    for (const field of fields) {
      if (isStubType(field.type) || field.type === "autoNumber") continue
      const v = toSubmitValue(field, src[field.name])
      if (v !== undefined) payload[field.name] = v
    }
    return payload
  }

  const reset = () => {
    setValues({})
    setLines([])
  }

  const onSaved = (headerValues: Record<string, unknown>, headerId: number) => {
    reset()
    const auto = form.fields.find((f) => f.type === "autoNumber")
    setSavedNo(auto !== undefined ? String(headerValues[auto.name] ?? headerId) : String(headerId))
  }
  const onError = (e: unknown) => {
    setSavedNo(null)
    setError(describeEngineError(e))
  }

  const submit = () => {
    const headerMissing = missingRequired(form.fields, values)
    if (headerMissing !== null) {
      setError(`「${headerMissing}」為必填`)
      return
    }
    setError(null)

    if (hasChild && childForm !== null) {
      for (const [index, line] of lines.entries()) {
        const lineMissing = missingRequired(childFields, line.values)
        if (lineMissing !== null) {
          setError(`第 ${index + 1} 行「${lineMissing}」為必填`)
          return
        }
      }
      saveWithLines.mutate(
        {
          childFormId: childForm.id,
          header: { values: buildPayload(form.fields, values) },
          lines: lines.map((l) => ({ values: buildPayload(childFields, l.values) })),
        },
        {
          onSuccess: (result) => onSaved(result.header.values, result.header.id),
          onError,
        },
      )
      return
    }

    createRecord.mutate(buildPayload(form.fields, values), {
      onSuccess: (record) => onSaved(record.values, record.id),
      onError,
    })
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface py-4">
      <div className="mx-auto max-w-[880px] px-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[16px] font-semibold text-ink">新增{form.name}</span>
          <div className="ml-auto flex gap-1.5">
            <Button onClick={reset}>清除</Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? "儲存中…" : "儲存"}
            </Button>
          </div>
        </div>

        {savedNo !== null ? (
          <div className="mb-3 rounded-md border border-ok-line bg-ok-t px-3 py-2 text-[12px] text-ok">
            已儲存:<b className="font-mono">{savedNo}</b>(可於「資料」檢視)
          </div>
        ) : null}
        {error !== null ? (
          <div className="mb-3 rounded-md border border-er-line bg-er-t px-3 py-2 text-[14px] text-er">
            {error}
          </div>
        ) : null}

        <section className="w-fit max-w-full overflow-x-auto rounded-md border border-line bg-card">
          <header className="flex items-center gap-2 border-b border-line bg-head px-3.5 py-2 text-[12px] font-semibold text-ink-2">
            <span className="size-1.5 rounded-full bg-primary" />
            填寫
          </header>
          <HeaderFields
            fields={form.fields}
            layout={layoutQuery.data?.layout ?? null}
            values={values}
            renderInput={(field, readonly, placeholder) => {
              const shown =
                field.type === "formula" ? headerPreview[field.name] : values[field.name]
              /* 版面唯讀 = **介面層的可用性約束,不是權限**。真正的欄位級權限在 E-1
                 (後端 assertWritable)。此處刻意只做「不給編輯器」,不假裝它擋得住 API。 */
              if (readonly) {
                return (
                  <span className="px-2.5 py-[5px] text-[13px] text-ink-2">
                    {formatFieldValue(field, shown, undefined, fmtCtx)}
                  </span>
                )
              }
              return (
                <FieldInput
                  field={field}
                  formId={formId}
                  value={shown}
                  onChange={(v) => set(field.name, v)}
                  /* R1·LNK M2:連結欄選取當下把來源欄值帶進兄弟欄位 */
                  onLoadMany={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
                  /* 連動選項:同一筆的其他欄值 + 同表欄位清單(父欄的選項在它自己的 options 裡) */
                  siblings={values}
                  fields={form.fields}
                  placeholder={placeholder}
                />
              )
            }}
          />
        </section>

        {hasChild ? (
          <section className="mt-3 overflow-hidden rounded-md border border-line bg-card">
            <header className="flex items-center gap-2 border-b border-line bg-head px-3.5 py-2 text-[12px] font-semibold text-ink-2">
              <span className="size-1.5 rounded-full bg-primary" />
              {childForm?.name}
              <span className="font-normal text-ink-3">明細</span>
              <Button variant="subtle" size="sm" onClick={addLine} className="ml-auto">
                <Plus />
                加一行
              </Button>
            </header>
            {childFields.length === 0 ? (
              <div className="p-4 text-center text-[12px] text-ink-3">子表載入中…</div>
            ) : lines.length === 0 ? (
              <div className="p-4 text-center text-[12px] text-ink-3">點「＋ 加一行」新增明細</div>
            ) : (
              <div className="overflow-x-auto">
                <table
                  ref={grid.containerRef as React.RefObject<HTMLTableElement>}
                  role="grid"
                  aria-label="明細子表"
                  aria-rowcount={lines.length}
                  aria-colcount={childFields.length}
                  className="min-w-full border-collapse text-[12px]"
                >
                  <thead>
                    <tr className="bg-head">
                      <th className="w-8 border-b border-line-2 px-2 py-1.5 text-left font-semibold text-ink-3">
                        #
                      </th>
                      {childFields.map((field) => (
                        <th
                          key={field.id}
                          className="border-b border-l border-cell px-2 py-1.5 text-left font-semibold text-ink-2 whitespace-nowrap"
                        >
                          {field.required ? <span className="mr-0.5 text-er">*</span> : null}
                          {field.name}
                        </th>
                      ))}
                      <th className="w-12 border-b border-l border-cell px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <tr
                        key={line.key}
                        className="group transition-colors duration-fast-01 ease-productive-exit hover:bg-head/60"
                      >
                        <td className="border-b border-line-2 px-2 py-1 font-mono text-ink-3">
                          {index + 1}
                        </td>
                        {childFields.map((field, colIndex) => (
                          <td
                            key={field.id}
                            role="gridcell"
                            {...grid.cellProps(index, colIndex)}
                            className="border-b border-l border-line-2 px-1.5 py-1 focus:outline-2 focus:outline-offset-[-2px] focus:outline-primary"
                          >
                            <FieldInput
                              field={field}
                              formId={childForm?.id ?? formId}
                              value={line.values[field.name]}
                              onChange={(v) => patchLine(line.key, field.name, v)}
                              /* 明細列的連動只看**同一列**,不看主檔 */
                              siblings={line.values}
                              fields={childFields}
                            />
                          </td>
                        ))}
                        <td className="border-b border-l border-line-2 px-1.5 py-1 text-center">
                          <Button
                            variant="subtle"
                            size="icon"
                            onClick={() => removeLine(line.key)}
                            title="刪除此行"
                            className="opacity-0 hover:bg-er-t hover:text-er focus:opacity-100 group-hover:opacity-100"
                          >
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}
