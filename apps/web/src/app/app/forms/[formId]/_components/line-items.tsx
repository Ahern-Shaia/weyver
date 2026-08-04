"use client"

import { formatFieldValue } from "@/components/form/value"
import { displayValue } from "@/lib/engine/display-value"
import { useMemberNames } from "@/lib/engine/authz"
import { useDisplayCtx } from "@/lib/engine/use-settings"
import { useForm, useLinkLabels, useRecords } from "@/lib/engine/hooks"
import type { FieldDto } from "@/lib/engine/schemas"
import type { ReactNode } from "react"

/* 明細子表 + rollup 合計(真資料:子表 saveWithLines + 記錄 + 讀時算,皆 P0-3 SHIPPED)。
   數值欄(money/number/percent)於 tfoot 加總 —— 引擎算不是人填。 */
const NUMERIC = new Set(["money", "number", "percent"])

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""))
  return Number.isFinite(n) ? n : 0
}
/* 🔴 小計與合計改走共用的 `display-value` —— 原本這裡自己 toLocaleString、
   最多兩位小數,與 object page 的 `String(v)` 各印各的。同一筆金額在主檔與明細
   顯示成不同樣子,是最傷信任的一種不一致。 */

export function LineItems({
  childFormId,
  parentRecordId,
}: {
  readonly childFormId: number
  readonly parentRecordId: number
}): ReactNode {
  const { data: childForm } = useForm(childFormId)
  const { data: resp } = useRecords(childFormId)

  const cols = (childForm?.fields ?? []).filter((f) => f.type !== "autoNumber")
  /* 🔴 audit-E §2.2|**這一格原本走 `displayValue`** —— 那支不認識 member / link /
     附件,於是記錄頁的明細表格印的是 actor id、目標記錄 id 與 `[object Object]`。
     改走 `formatFieldValue`(其餘唯讀面都走這支),差別只在多帶三張對照表。 */
  const memberNames = useMemberNames(childForm?.fields ?? [])
  const fmtCtx = useDisplayCtx()
  const linkLabels = useLinkLabels(childFormId, childForm?.fields ?? [], resp?.records ?? [])
  const lines = (resp?.records ?? [])
    .filter((r) => r.parentId === parentRecordId)
    .sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0))

  const totals = new Map<number, number>()
  for (const f of cols) {
    if (NUMERIC.has(f.type)) {
      totals.set(
        f.id,
        lines.reduce((s, r) => s + toNum(r.values[f.name]), 0),
      )
    }
  }
  const hasTotals = totals.size > 0 && lines.length > 0

  const isNum = (f: FieldDto): boolean => NUMERIC.has(f.type)

  return (
    <div className="overflow-hidden rounded-md border border-line bg-card">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-head">
            <th className="w-8 px-2 py-2 text-left font-mono text-[12px] font-semibold text-ink-3">
              #
            </th>
            {cols.map((f) => (
              <th
                key={f.id}
                className={`px-3 py-2 font-semibold text-[12px] text-ink-3 ${isNum(f) ? "text-right" : "text-left"}`}
              >
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((r, i) => (
            <tr key={r.id} className="border-t border-line-2">
              <td className="px-2 py-1.5 font-mono text-[12px] text-ink-3">{i + 1}</td>
              {cols.map((f) => (
                <td
                  key={f.id}
                  className={
                    isNum(f)
                      ? "px-3 py-1.5 text-right font-mono tabular-nums text-ink"
                      : "px-3 py-1.5 text-ink"
                  }
                >
                  {formatFieldValue(
                    f,
                    isNum(f) ? toNum(r.values[f.name]) : r.values[f.name],
                    memberNames,
                    fmtCtx,
                    linkLabels,
                  )}
                </td>
              ))}
            </tr>
          ))}
          {lines.length === 0 ? (
            <tr>
              <td colSpan={cols.length + 1} className="px-3 py-3 text-[12px] text-ink-3">
                此單據尚無明細。
              </td>
            </tr>
          ) : null}
        </tbody>
        {hasTotals ? (
          <tfoot>
            <tr className="border-t border-line-2 bg-label font-semibold">
              <td className="px-2 py-2 text-[12px] text-ink-2">合計</td>
              {cols.map((f) => (
                <td
                  key={f.id}
                  className={
                    isNum(f) ? "px-3 py-2 text-right font-mono tabular-nums text-ink" : "px-3 py-2"
                  }
                >
                  {isNum(f) ? displayValue(f, totals.get(f.id) ?? 0) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}
