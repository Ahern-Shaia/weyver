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

const changeSchema = z.object({
  id: z.number(),
  formId: z.number().nullable(),
  formName: z.string().nullable(),
  action: z.string(),
  spec: z.record(z.string(), z.unknown()),
  result: z.string(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
})

/* 設計變更的 spec 是引擎的內部形狀,直接印 JSON 沒人看得懂。
   挑出「使用者認得的那幾個鍵」,其餘不顯示 —— 寧可少講,不要講一堆看不懂的。
   ⚠️ 這裡刻意不做完整翻譯:action 的種類會長,而**猜錯比不猜更糟**。 */
function describeSpec(spec: Record<string, unknown>): string {
  const parts: string[] = []
  const pick = (k: string, label: string): void => {
    const v = spec[k]
    if (typeof v === "string" && v !== "") parts.push(`${label} ${v}`)
  }
  pick("name", "名稱")
  pick("fieldName", "欄位")
  pick("from", "原型別")
  pick("to", "新型別")
  return parts.join(" · ")
}

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

  /* 🔴 Ragic 官方 `doc/81` 逐字:「**頁面下方**,可以看到**資料庫設計變更**。」
     同一頁的下半部,不另開一頁 —— 兩者都是「這個資料庫最近發生了什麼」。 */
  const { data: changes, isPending: changesPending } = useQuery({
    queryKey: ["settings", "design-changes"] as const,
    queryFn: () =>
      engineFetch("/forms/revisions/design-changes", z.object({ changes: z.array(changeSchema) })),
  })
  const changeRows = changes?.changes ?? []

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
        <table data-testid="revision-log" className="mt-3 w-full text-[12px]">
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
      <h3 className="mt-8 text-[14px] font-semibold text-ink">資料庫設計變更</h3>
      <p className="mt-1 text-[12px] text-ink-3">
        表單與欄位結構的異動。此處不顯示引擎實際執行的語句。
      </p>
      {changesPending ? (
        /* 載入中講「沒有」是說謊 —— 上半部已經是這個處理,兩邊要一致 */
        <p className="mt-3 text-[12px] text-ink-3">載入中…</p>
      ) : changeRows.length === 0 ? (
        <p className="mt-3 text-[12px] text-ink-3">沒有你有權檢視的表單之設計變更。</p>
      ) : (
        <table data-testid="design-changes" className="mt-3 w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="py-1.5 font-medium">時間</th>
              <th className="py-1.5 font-medium">表單</th>
              <th className="py-1.5 font-medium">動作</th>
              <th className="py-1.5 font-medium">內容</th>
              <th className="py-1.5 font-medium">結果</th>
            </tr>
          </thead>
          <tbody>
            {changeRows.map((c) => (
              <tr key={c.id} className="border-b border-line-2">
                <td className="py-1.5 font-mono text-ink-3">{formatDateTime(c.createdAt, ctx)}</td>
                <td className="py-1.5 text-ink-2">{c.formName ?? "(租戶層)"}</td>
                <td className="py-1.5 font-mono text-ink-2">{c.action}</td>
                <td className="py-1.5 text-ink-3">{describeSpec(c.spec)}</td>
                <td className="py-1.5">
                  {c.result === "ok" ? (
                    <span className="text-ink-3">成功</span>
                  ) : (
                    /* 失敗的設計變更要看得出來 —— 那通常是「為什麼我的欄位沒加上去」的答案 */
                    <span className="text-er" title={c.errorMessage ?? undefined}>
                      {c.result}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
