"use client"

import { Clock, FileText, Pencil } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { type ReactNode, useState } from "react"
import type { FieldDto, RecordRow } from "@/lib/engine/schemas"
import { useForm, useRecords } from "@/lib/engine/hooks"

/* 表單工作台(記錄 Object Page)—— 三欄:記錄清單 | 單據(label/value 檢視)| 稽核脈絡。
   對應 weyver-workbench-uplift mockup(honest 子集:GL/簽核為 R2,不列)。接真 useForm+useRecords。 */
function fmt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (Array.isArray(value)) return value.length ? value.map(String).join("、") : "—"
  if (typeof value === "boolean") return value ? "是" : "否"
  return String(value)
}

function titleOf(record: RecordRow, fields: readonly FieldDto[]): string {
  const first = fields[0]
  const v = first ? record.values[first.name] : undefined
  return v !== undefined && v !== null && v !== "" ? String(v) : `記錄 #${record.id}`
}

export default function RecordWorkbench(): ReactNode {
  const params = useParams<{ formId: string }>()
  const formId = Number(params.formId)
  const { data: form, isPending: formPending } = useForm(
    Number.isSafeInteger(formId) ? formId : null,
  )
  const { data: resp, isPending: recPending } = useRecords(
    Number.isSafeInteger(formId) ? formId : null,
  )
  const [selId, setSelId] = useState<number | null>(null)

  const fields = (form?.fields ?? []).filter((f) => f.type !== "formula")
  const records = resp?.records ?? []
  const selected = records.find((r) => r.id === selId) ?? records[0] ?? null

  return (
    <div className="flex h-full min-h-0">
      {/* record list */}
      <div className="flex w-60 shrink-0 flex-col border-r border-line bg-card">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <b className="truncate text-[12.5px] font-semibold">{form?.name ?? "表單"}</b>
          <span className="ml-auto rounded-xs border border-line px-1.5 font-mono text-[10px] text-ink-3">
            {records.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {recPending ? (
            <div className="px-3 py-2 text-[11.5px] text-ink-4">載入記錄…</div>
          ) : records.length === 0 ? (
            <div className="px-3 py-3 text-[11.5px] text-ink-4">尚無記錄。</div>
          ) : (
            records.map((r) => {
              const active = selected?.id === r.id
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setSelId(r.id)}
                  className={
                    active
                      ? "block w-full border-b border-line-2 border-l-2 border-l-primary bg-primary-t px-3 py-2 text-left"
                      : "block w-full border-b border-line-2 border-l-2 border-l-transparent px-3 py-2 text-left hover:bg-surface"
                  }
                >
                  <div className="truncate text-[12px] font-medium text-ink">
                    {titleOf(r, fields)}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">#{r.id}</div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* document — Object Page (label/value 檢視) */}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        {formPending ? (
          <div className="p-6 text-[12px] text-ink-3">載入…</div>
        ) : selected && form ? (
          <>
            <div className="shrink-0 border-b border-line bg-card px-6 pt-3 pb-3">
              <div className="text-[11px] text-ink-4">
                <Link href="/app" className="hover:text-primary">
                  工作區
                </Link>{" "}
                / <span className="font-medium text-ink-3">{form.name}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <h3 className="text-[16px] font-semibold text-ink">{titleOf(selected, fields)}</h3>
                <span className="font-mono text-[11px] text-ink-4">
                  #{selected.id} · v{selected.version}
                </span>
                <Link
                  href={`/app/builder?form=${formId}`}
                  className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-[12px] text-ink-2 hover:bg-head"
                >
                  <Pencil size={13} strokeWidth={1.9} />
                  在設計器開啟
                </Link>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="mb-2.5 text-[11.5px] font-semibold text-ink-3">基本資料</div>
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.id} className="flex items-baseline gap-3 border-b border-line-2 py-2">
                    <span className="w-24 shrink-0 text-[11px] text-ink-4">{f.name}</span>
                    <span
                      className={
                        f.type === "money" || f.type === "number" || f.type === "autoNumber"
                          ? "flex-1 font-mono text-[12.5px] tabular-nums text-ink"
                          : "flex-1 text-[12.5px] text-ink"
                      }
                    >
                      {fmt(selected.values[f.name])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div className="max-w-[320px]">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-md border border-line bg-card text-ink-4">
                <FileText size={22} strokeWidth={1.5} />
              </div>
              <p className="text-[12.5px] text-ink-3">此表單尚無記錄。到設計器填第一筆。</p>
              <Link
                href={`/app/builder?form=${formId}`}
                className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12.5px] font-medium text-white"
              >
                在設計器開啟
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* context rail — 稽核 */}
      <div className="flex w-64 shrink-0 flex-col border-l border-line bg-card">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 text-[12px] font-semibold text-primary">
          <Clock size={14} strokeWidth={1.9} />
          稽核
        </div>
        {selected ? (
          <div className="flex-1 overflow-y-auto p-4">
            <Meta k="記錄" v={`#${selected.id}`} mono />
            <Meta k="版本" v={`v${selected.version}`} mono />
            <Meta k="建立" v={selected.createdAt.replace("T", " ").slice(0, 19)} mono />
            <Meta k="建立者" v={`actor #${selected.createdBy}`} mono />
            <Meta k="最後更新" v={selected.updatedAt.replace("T", " ").slice(0, 19)} mono />
            {selected.parentId !== null ? (
              <Meta k="所屬單據" v={`#${selected.parentId}`} mono />
            ) : null}
          </div>
        ) : (
          <div className="p-4 text-[11.5px] text-ink-4">選一筆記錄看稽核資訊。</div>
        )}
      </div>
    </div>
  )
}

function Meta({
  k,
  v,
  mono,
}: { readonly k: string; readonly v: string; readonly mono?: boolean }): ReactNode {
  return (
    <div className="flex items-baseline gap-2 border-b border-line-2 py-2">
      <span className="w-16 shrink-0 text-[11px] text-ink-4">{k}</span>
      <span className={mono ? "font-mono text-[11.5px] text-ink-2" : "text-[12px] text-ink-2"}>
        {v}
      </span>
    </div>
  )
}
