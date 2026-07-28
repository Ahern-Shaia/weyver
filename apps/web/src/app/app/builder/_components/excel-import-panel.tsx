"use client"

import { Button } from "@weyver/ui/button"
import { Input } from "@weyver/ui/input"
import { cn } from "@weyver/ui/lib/utils"
import { Select } from "@weyver/ui/select"
import { useRef, useState } from "react"
import { describeEngineError, engineFetch } from "@/lib/engine/client"
import { BUILDABLE_TYPES, fieldTypeMeta } from "@/lib/engine/field-types"
import { useCreateForm } from "@/lib/engine/hooks"
import type { CellValueType, CreateFormInput } from "@/lib/engine/schemas"
import { z } from "zod"
import { inferColumnType, toImportValue } from "./excel-import"
import { columnValues, MAX_IMPORT_ROWS, parseFirstSheet, type ParsedSheet } from "./excel-parse"

const IMPORT_TYPES = BUILDABLE_TYPES.filter((t) => t !== "autoNumber")
const PREVIEW_ROWS = 8
const bulkResultSchema = z.object({ created: z.number().int() })

interface ColumnDraft {
  readonly key: string
  readonly sourceIndex: number
  name: string
  type: CellValueType
  required: boolean
  skip: boolean
  choices: readonly string[]
  readonly samples: readonly string[]
}

function distinctValues(values: readonly string[]): string[] {
  const set = new Set<string>()
  for (const v of values) {
    const t = v.trim()
    if (t !== "") set.add(t)
    if (set.size >= 50) break
  }
  return [...set]
}

function buildDrafts(sheet: ParsedSheet): ColumnDraft[] {
  return sheet.columns.map((name, index) => {
    const values = columnValues(sheet.rows, index)
    const inferred = inferColumnType(values, sheet.rows.length, name)
    return {
      key: `c${index}`,
      sourceIndex: index,
      name,
      type: inferred.type,
      required: false,
      skip: false,
      choices: inferred.choices ?? distinctValues(values),
      samples: distinctValues(values).slice(0, 3),
    }
  })
}

export function ExcelImportPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (formId: number) => void
  onCancel: () => void
}) {
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [fileName, setFileName] = useState("")
  const [name, setName] = useState("")
  const [drafts, setDrafts] = useState<ColumnDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const createForm = useCreateForm()

  const patch = (key: string, next: Partial<ColumnDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...next } : d)))

  const onFile = async (file: File): Promise<void> => {
    setError(null)
    try {
      const parsed = parseFirstSheet(await file.arrayBuffer())
      if (parsed.columns.length === 0) {
        setError("找不到欄位(首列為空)")
        return
      }
      setSheet(parsed)
      setFileName(file.name)
      setName(parsed.sheetName || file.name.replace(/\.(xlsx|xls)$/i, ""))
      setDrafts(buildDrafts(parsed))
    } catch (e) {
      setError(e instanceof Error ? `解析失敗:${e.message}` : "解析失敗")
    }
  }

  const runImport = async (): Promise<void> => {
    if (sheet === null) return
    const active = drafts.filter((d) => !d.skip)
    if (name.trim() === "") return setError("請輸入表單名稱")
    if (active.length === 0) return setError("請至少保留一個欄位")
    const seen = new Set<string>()
    for (const d of active) {
      const n = d.name.trim()
      if (n === "") return setError("欄位名稱不可空白")
      if (seen.has(n)) return setError(`欄位名稱重複:${n}`)
      seen.add(n)
    }

    const input: CreateFormInput = {
      name: name.trim(),
      fields: active.map((d) => ({
        name: d.name.trim(),
        type: d.type,
        required: d.required,
        options: fieldTypeMeta(d.type).needsChoices ? { choices: [...d.choices] } : {},
      })),
    }

    setError(null)
    setImporting(true)
    try {
      const form = await createForm.mutateAsync(input)
      const rows = sheet.rows
        .map((row) => {
          const values: Record<string, unknown> = {}
          for (const d of active) {
            const cell = row[d.sourceIndex] ?? ""
            const converted = toImportValue(d.type, cell)
            if (converted !== undefined) values[d.name.trim()] = converted
          }
          return values
        })
        .filter((v) => Object.keys(v).length > 0)

      if (rows.length > 0) {
        await engineFetch(`/forms/${form.id}/records/bulk`, bulkResultSchema, {
          method: "POST",
          body: { rows: rows.map((values) => ({ values })) },
        })
      }
      onCreated(form.id)
    } catch (e) {
      setError(describeEngineError(e))
      setImporting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-card px-4 py-2">
        <span className="text-[12.5px] font-semibold">匯入 Excel 建立表單</span>
        {fileName !== "" ? (
          <span className="font-mono text-[10.5px] text-ink-4">{fileName}</span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <Button onClick={onCancel} disabled={importing}>
            取消
          </Button>
          {sheet !== null ? (
            <Button variant="primary" onClick={() => void runImport()} disabled={importing}>
              {importing ? "匯入中…" : `建立並匯入 ${sheet.rows.length} 列`}
            </Button>
          ) : null}
        </div>
      </div>

      {error !== null ? (
        <div className="border-b border-er-line bg-er-t px-4 py-1.5 text-[12px] text-er">
          {error}
        </div>
      ) : null}

      {sheet === null ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-[380px] text-center">
            <p className="text-[13px] font-medium text-ink-2">選擇 .xlsx 檔</p>
            <p className="mt-1 mb-4 text-[11.5px] text-ink-4">
              前端解析,原檔不上傳;取首工作表首列為欄名,系統推斷欄位型別後可校正。
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file !== undefined) void onFile(file)
              }}
            />
            <Button variant="primary" onClick={() => fileRef.current?.click()}>
              選擇檔案
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[900px]">
            <label className="mb-3 flex max-w-[360px] flex-col gap-1 text-[11px] text-ink-2">
              表單名稱
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>

            {sheet.truncated ? (
              <div className="mb-3 border border-line bg-head px-3 py-1.5 text-[11px] text-ink-4">
                資料超過 {MAX_IMPORT_ROWS} 列,本次只匯入前 {MAX_IMPORT_ROWS} 列。
              </div>
            ) : null}

            <section className="mb-4 border border-line bg-card">
              <header className="bg-primary px-3 py-1.5 text-[12px] font-semibold text-white">
                欄位對映({drafts.filter((d) => !d.skip).length}/{drafts.length})
              </header>
              <ul>
                {drafts.map((d, index) => {
                  const isLast = index === drafts.length - 1
                  return (
                    <li
                      key={d.key}
                      className={cn(
                        "flex items-center gap-2 p-2.5",
                        !isLast && "border-b border-cell",
                        d.skip && "opacity-45",
                      )}
                    >
                      <label className="flex shrink-0 items-center gap-1 text-[10.5px] text-ink-3">
                        <input
                          type="checkbox"
                          checked={!d.skip}
                          onChange={(e) => patch(d.key, { skip: !e.target.checked })}
                          className="accent-(--color-primary)"
                        />
                        匯入
                      </label>
                      <Input
                        value={d.name}
                        onChange={(e) => patch(d.key, { name: e.target.value })}
                        disabled={d.skip}
                        className="w-40 shrink-0"
                      />
                      <Select
                        value={d.type}
                        onChange={(e) => patch(d.key, { type: e.target.value as CellValueType })}
                        disabled={d.skip}
                        className="h-7 shrink-0"
                      >
                        {IMPORT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {fieldTypeMeta(t).label}
                          </option>
                        ))}
                      </Select>
                      <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2">
                        <input
                          type="checkbox"
                          checked={d.required}
                          onChange={(e) => patch(d.key, { required: e.target.checked })}
                          disabled={d.skip}
                          className="accent-(--color-primary)"
                        />
                        必填
                      </label>
                      <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-4">
                        {d.samples.join(" · ")}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="border border-line bg-card">
              <header className="border-b border-line bg-head px-3 py-1.5 text-[11px] font-semibold text-ink-2">
                資料預覽(前 {Math.min(PREVIEW_ROWS, sheet.rows.length)} 列 / 共 {sheet.rows.length})
              </header>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      {drafts.map((d) => (
                        <th
                          key={d.key}
                          className={cn(
                            "border-b border-r border-cell bg-label px-2 py-1 text-left font-medium text-ink-2",
                            d.skip && "opacity-45",
                          )}
                        >
                          {d.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                      <tr key={`r${r}`}>
                        {drafts.map((d) => (
                          <td
                            key={d.key}
                            className={cn(
                              "border-b border-r border-cell px-2 py-1 text-ink-2",
                              d.skip && "opacity-45",
                            )}
                          >
                            {row[d.sourceIndex] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
