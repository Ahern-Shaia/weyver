"use client"

import type { ReactNode } from "react"

import type { TriggerRunDto } from "@/lib/engine/schemas"

/* 🔴 R1·C-5|觸發器執行紀錄。

   從 `triggers-panel.tsx` 拆出來(加完排程後超過 400 行紅線)。
   邊界乾淨:這是**唯讀顯示**,與上方的新增表單零共用狀態。

   ⚠️ 這一段不是裝飾。`denied` / `depth` / `failed` 一定要看得到 ——
   **靜默停止的自動化比不會動的自動化更難查**,使用者只會說「它沒反應」。
   定時觸發尤其:它在半夜跑,沒有人在現場看得到它有沒有動。 */

const OUTCOME_LABEL: Record<string, string> = {
  ran: "已執行",
  skipped: "條件不符",
  denied: "權限不足",
  failed: "執行失敗",
  depth: "連鎖過深已停",
  /* 🔴 FMEA S1|排定的時刻過去了而它沒跑。**不是失敗,是沒發生** ——
     文案要講出「該跑而沒跑」,不能只寫「未執行」(那讀起來像條件不符)。 */
  missed: "漏跑(服務當時沒在執行)",
}

export function TriggerRuns({ runs }: { readonly runs: readonly TriggerRunDto[] }): ReactNode {
  if (runs.length === 0) return null
  return (
    <div className="flex flex-col gap-1 border-t border-line-2 pt-2.5">
      <span className="text-ink-3">最近執行</span>
      {runs.slice(0, 20).map((r) => (
        <div key={r.id} className="flex gap-2">
          <span className="min-w-0 flex-1 truncate text-ink-2">{r.triggerName}</span>
          <span className="shrink-0 text-ink-3">#{r.recordId}</span>
          <span className={r.outcome === "ran" ? "shrink-0 text-ink-3" : "shrink-0 text-wa"}>
            {OUTCOME_LABEL[r.outcome] ?? r.outcome}
          </span>
        </div>
      ))}
    </div>
  )
}
