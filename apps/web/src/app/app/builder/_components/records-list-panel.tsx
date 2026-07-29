"use client"

import { useMemberNames } from "@/lib/engine/authz"
import { describeEngineError } from "@/lib/engine/client"
import { useForm, useRecords } from "@/lib/engine/hooks"
import { formatFieldValue } from "./field-value"

export function RecordsListPanel({ formId }: { formId: number }) {
  const formQuery = useForm(formId)
  const recordsQuery = useRecords(formId)
  const memberNames = useMemberNames(formQuery.data?.fields ?? [])

  if (formQuery.data === undefined) {
    return <div className="p-6 text-[12px] text-ink-3">載入中…</div>
  }
  const fields = formQuery.data.fields

  return (
    <div className="flex-1 overflow-auto bg-surface p-4">
      {recordsQuery.isLoading ? (
        <div className="text-[12px] text-ink-3">載入資料中…</div>
      ) : recordsQuery.isError ? (
        <div className="text-[12px] text-er">
          載入失敗:{describeEngineError(recordsQuery.error)}
        </div>
      ) : (recordsQuery.data?.records.length ?? 0) === 0 ? (
        <div className="flex h-full items-center justify-center">
          <div className="max-w-[300px] text-center">
            <p className="text-[13px] font-medium text-ink-2">尚無資料</p>
            <p className="mt-1 text-[11.5px] text-ink-4">切到「填單」新增第一筆記錄。</p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto border border-line bg-card">
          <table className="min-w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-head">
                <th className="border-b border-cell px-2.5 py-1.5 text-left font-semibold text-ink-3">
                  #
                </th>
                {fields.map((field) => (
                  <th
                    key={field.id}
                    className="border-b border-l border-cell px-2.5 py-1.5 text-left font-semibold text-ink-2 whitespace-nowrap"
                  >
                    {field.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recordsQuery.data?.records.map((record) => (
                <tr key={record.id} className="hover:bg-head">
                  <td className="border-b border-cell px-2.5 py-1.5 font-mono text-ink-4">
                    {record.id}
                  </td>
                  {fields.map((field) => (
                    <td
                      key={field.id}
                      className="border-b border-l border-cell px-2.5 py-1.5 whitespace-nowrap text-ink"
                    >
                      {formatFieldValue(field, record.values[field.name], memberNames)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
