"use client"

import { Select } from "@weyver/ui/select"
import { useState } from "react"
import type { ReactNode } from "react"
import Link from "next/link"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { engineFetch } from "@/lib/engine/client"
import { useForms } from "@/lib/engine/hooks"
import { useDisplayCtx } from "@/lib/engine/use-settings"
import { formatDateTime } from "@/lib/engine/display-value"
import { DesignChanges } from "./design-changes"

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

/* 🔴 v1.2|批次(匯入 / 貼上)。Ragic 官方截圖把整批折成一列:
   「黃志銘 在 倉庫管理 上 修改 了 4 筆資料 (大量修改) ↺」—— 不是 N 列各帶一個鈕。 */
const batchSchema = z.object({
  id: z.number(),
  formId: z.number(),
  formName: z.string(),
  kind: z.string(),
  actorId: z.number().nullable(),
  createdAt: z.string(),
  recordCount: z.number(),
  undoneAt: z.string().nullable(),
  undoable: z.boolean(),
})

const BATCH_LABEL: Record<string, string> = {
  import: "匯入",
  paste: "貼上",
  undo: "還原",
}

const recentSchema = z.object({
  revisions: z.array(revisionSchema),
  batches: z.array(batchSchema),
})

const undoResultSchema = z.object({
  formId: z.number(),
  undoneRecords: z.number(),
  skipped: z.array(
    z.object({ recordId: z.number(), field: z.string().nullable(), reason: z.string() }),
  ),
})

export default function RevisionsPage(): ReactNode {
  const [formId, setFormId] = useState("")
  const { data: forms } = useForms()
  const ctx = useDisplayCtx()
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: ["settings", "revisions", formId] as const,
    queryFn: () =>
      engineFetch(
        `/forms/revisions/recent${formId === "" ? "" : `?formId=${formId}`}`,
        recentSchema,
      ),
  })

  /* 單筆與批次是**同一條時間軸**上的兩種事件 —— Ragic 也是混在同一串裡。
     分兩張表會讓使用者要自己在腦裡對時間。 */
  const rows = [
    ...(data?.revisions ?? []).map((r) => ({ kind: "one" as const, at: r.createdAt, one: r })),
    ...(data?.batches ?? []).map((b) => ({ kind: "batch" as const, at: b.createdAt, batch: b })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const undo = useMutation({
    mutationFn: (batchId: number) =>
      engineFetch(`/forms/revisions/batches/${String(batchId)}/undo`, undoResultSchema, {
        method: "POST",
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "revisions"] })
      /* 🔴 跳過的格子要說出來。少還原了幾格而使用者不知道,比整批不還原更糟 ——
         他會以為回到原狀了(OQ-RV-10:不靜默)。 */
      const note =
        result.skipped.length === 0
          ? ""
          : `\n\n有 ${String(result.skipped.length)} 處未還原(後來被改過或欄位已移除):\n${result.skipped
              .slice(0, 10)
              .map((s) => `· #${String(s.recordId)} ${s.field ?? ""} — ${s.reason}`)
              .join("\n")}`
      window.alert(`已還原 ${String(result.undoneRecords)} 筆資料。${note}`)
    },
    onError: (error: Error) => {
      window.alert(`還原失敗:${error.message}`)
    },
  })

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
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              if (entry.kind === "one") {
                const r = entry.one
                return (
                  <tr
                    key={`r-${String(r.formId)}-${String(r.recordId)}-${String(r.version)}-${r.createdAt}`}
                    className="border-b border-line-2"
                  >
                    <td className="py-1.5 font-mono text-ink-3">
                      {formatDateTime(r.createdAt, ctx)}
                    </td>
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
                    <td />
                  </tr>
                )
              }
              const b = entry.batch
              const label = BATCH_LABEL[b.kind] ?? b.kind
              return (
                <tr key={`b-${String(b.id)}`} className="border-b border-line-2">
                  <td className="py-1.5 font-mono text-ink-3">
                    {formatDateTime(b.createdAt, ctx)}
                  </td>
                  <td className="py-1.5 text-ink-2">{b.formName}</td>
                  <td className="py-1.5 text-ink-3">{b.recordCount} 筆</td>
                  <td className="py-1.5 text-ink-2">{label}</td>
                  <td className="py-1.5 text-ink-3">
                    {b.undoneAt === null ? "" : `已於 ${formatDateTime(b.undoneAt, ctx)} 還原`}
                  </td>
                  <td className="py-1.5 text-right">
                    {b.undoable ? (
                      <button
                        type="button"
                        className="text-primary hover:underline disabled:opacity-disabled"
                        disabled={undo.isPending}
                        onClick={() => {
                          /* 官方限制 2 逐字:「此動作一旦被執行便無法復原。」
                             說清楚會發生什麼再問 —— 匯入的還原是把那批資料刪掉。 */
                          const what =
                            b.kind === "import"
                              ? `會把這批匯入的 ${String(b.recordCount)} 筆資料刪除(可在回收桶找回)`
                              : `會把這 ${String(b.recordCount)} 筆資料還原成修改前的值`
                          if (window.confirm(`${what}。還原本身無法再還原,確定嗎?`)) {
                            undo.mutate(b.id)
                          }
                        }}
                      >
                        還原
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <DesignChanges />
    </div>
  )
}
