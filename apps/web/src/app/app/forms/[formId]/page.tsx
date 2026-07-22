"use client"

import { FileText } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { type ReactNode, useState } from "react"
import { useForm, useForms, useRecords } from "@/lib/engine/hooks"
import { ObjectPage } from "./_components/object-page"
import { RecordList } from "./_components/record-list"

/* 表單工作台 —— 記錄清單 | Object Page(黏頂頭 + 錨點 + 基本資料 + 明細 rollup + 稽核)。
   對應 weyver-workbench-uplift mockup 架構,只接真資料;R2 之 GL/簽核不放(不造假)。
   orchestrator 薄殼,細節見 _components/。 */
export default function RecordWorkbench(): ReactNode {
  const params = useParams<{ formId: string }>()
  const formId = Number(params.formId)
  const valid = Number.isSafeInteger(formId)
  const { data: form, isPending: formPending } = useForm(valid ? formId : null)
  const { data: resp, isPending: recPending } = useRecords(valid ? formId : null)
  const { data: forms } = useForms()
  const [selId, setSelId] = useState<number | null>(null)

  const records = resp?.records ?? []
  const selected = records.find((r) => r.id === selId) ?? records[0] ?? null
  const childForm = (forms ?? []).find((f) => f.parentFormId === formId) ?? null

  return (
    <div className="flex h-full min-h-0">
      <RecordList
        formName={form?.name ?? "表單"}
        fields={form?.fields ?? []}
        records={records}
        loading={recPending}
        selectedId={selected?.id ?? null}
        onSelect={setSelId}
      />
      {formPending ? (
        <div className="flex-1 bg-surface p-6 text-[12px] text-ink-3">載入…</div>
      ) : selected && form ? (
        <ObjectPage form={form} record={selected} childForm={childForm} formId={formId} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-surface p-8 text-center">
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
  )
}
