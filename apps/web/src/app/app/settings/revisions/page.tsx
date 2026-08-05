"use client"

import { Select } from "@weyver/ui/select"
import { useState } from "react"
import type { ReactNode } from "react"
import Link from "next/link"
import { z } from "zod"
import { useQuery } from "@tanstack/react-query"

import { engineFetch } from "@/lib/engine/client"
import { useForms } from "@/lib/engine/hooks"
import { useDisplayCtx } from "@/lib/engine/use-settings"
import { formatDateTime } from "@/lib/engine/display-value"

/* 🔴 R1·H-4|全庫「資料修改紀錄」。

   Ragic 官方 `doc/81` 逐字:「你可以從左上角的**漢堡選單**下的**資料庫管理**
   找到**資料修改紀錄**。用來檢視所有資料的修改歷程。……
   想要瀏覽特定表單或時間的修改紀錄,可以進一步篩選。」

   ⚠️ **這一頁只回「動了哪些欄」不回值** —— 它一次橫跨數十張表,
   逐欄遮罩要為每張表各算一次污染閉包;而它的用途本來就是**找線索**不是看內容。
   要看內容點進那一筆的記錄頁,那裡有遮罩。 */

const revisionSchema = z.object({
  formId: z.number(),
  formName: z.string(),
  recordId: z.number(),
  version: z.number(),
  action: z.string(),
  actorId: z.number().nullable(),
  createdAt: z.string(),
  changedFields: z.array(z.string()),
})

export default function RevisionsPage(): ReactNode {
  const [formId, setFormId] = useState("")
  const { data: forms } = useForms()
  const ctx = useDisplayCtx()
  const { data, isPending } = useQuery({
    queryKey: ["settings", "revisions", formId] as const,
    queryFn: () =>
      engineFetch(
        `/forms/revisions/recent${formId === "" ? "" : `?formId=${formId}`}`,
        z.object({ revisions: z.array(revisionSchema) }),
      ),
  })

  const rows = data?.revisions ?? []

  return (
    <div className="p-6">
      <h2 className="text-[16px] font-semibold text-ink">資料修改紀錄</h2>
      <p className="mt-1 text-[12px] text-ink-3">
        {/* JSX 不解析 markdown —— 星號會原樣印出來(實走時看到) */}
        誰在什麼時候動過哪一筆。此處只列「動了哪些欄位」;要看前後值請點進該筆記錄。
      </p>

      <div className="mt-3 flex items-center gap-2">
        <Select
          className="h-7 w-56"
          aria-label="篩選表單"
          value={formId}
          onChange={(e) => setFormId(e.target.value)}
        >
          <option value="">全部表單</option>
          {(forms ?? []).map((f) => (
            <option key={f.id} value={String(f.id)}>
              {f.name}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-ink-3">最近 100 筆</span>
      </div>

      {isPending ? (
        <p className="mt-4 text-[12px] text-ink-3">載入中…</p>
      ) : rows.length === 0 ? (
        /* 空狀態要說得出為什麼是空的 —— 「沒有紀錄」與「你看不到」是兩件事 */
        <p className="mt-4 text-[12px] text-ink-3">沒有你有權檢視的表單之修改紀錄。</p>
      ) : (
        <table className="mt-3 w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="py-1.5 font-medium">時間</th>
              <th className="py-1.5 font-medium">表單</th>
              <th className="py-1.5 font-medium">記錄</th>
              <th className="py-1.5 font-medium">動作</th>
              <th className="py-1.5 font-medium">變更欄位</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${String(r.formId)}-${String(r.recordId)}-${String(r.version)}-${r.createdAt}`}
                className="border-b border-line-2"
              >
                <td className="py-1.5 font-mono text-ink-3">{formatDateTime(r.createdAt, ctx)}</td>
                <td className="py-1.5 text-ink-2">{r.formName}</td>
                <td className="py-1.5">
                  <Link
                    href={`/app/forms/${String(r.formId)}?record=${String(r.recordId)}&mode=record`}
                    className="text-primary hover:underline"
                  >
                    #{r.recordId}
                  </Link>
                </td>
                <td className="py-1.5 text-ink-2">
                  {r.action === "create" ? "建立" : `更新 · v${String(r.version)}`}
                </td>
                <td className="py-1.5 text-ink-3">{r.changedFields.join("、")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
