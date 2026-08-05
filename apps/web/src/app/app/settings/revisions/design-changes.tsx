"use client"

import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { z } from "zod"

import { engineFetch } from "@/lib/engine/client"
import { formatDateTime } from "@/lib/engine/display-value"
import { useDisplayCtx } from "@/lib/engine/use-settings"

/* 🔴 R1·H-4 v1.2|**資料庫設計變更**。Ragic 官方 `doc/81` 逐字:
   「頁面下方,可以看到**資料庫設計變更**。」—— 同一頁的下半部,不另開一頁,
   兩者都在回答「這個資料庫最近發生了什麼」。

   分成獨立檔只是為了檔案大小,不是分頁。 */

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

export function DesignChanges(): ReactNode {
  const ctx = useDisplayCtx()
  const { data, isPending } = useQuery({
    queryKey: ["settings", "design-changes"] as const,
    queryFn: () =>
      engineFetch("/forms/revisions/design-changes", z.object({ changes: z.array(changeSchema) })),
  })
  const changeRows = data?.changes ?? []
  const changesPending = isPending

  return (
    <>
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
    </>
  )
}
