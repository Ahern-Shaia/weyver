import type { ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2 §3.5|GL 過帳:借貸表 + 科目代碼 + 「✓ 借貸平衡」斷言列(永遠顯示可驗證依據) */
export interface GlEntry {
  readonly code: string
  readonly account: string
  readonly debit?: number
  readonly credit?: number
}

export interface GlTableProps {
  readonly entries: readonly GlEntry[]
  readonly className?: string
}

const th =
  "border border-t-0 border-cell bg-head px-2 py-[5px] text-[10.5px] font-semibold text-ink-2"
const td = "border border-cell px-2 py-[5px] text-[12px]"
const fmt = (n: number): string => n.toLocaleString("zh-TW")

export function GlTable({ entries, className }: GlTableProps): ReactElement {
  const totalDebit = entries.reduce((sum, entry) => sum + (entry.debit ?? 0), 0)
  const totalCredit = entries.reduce((sum, entry) => sum + (entry.credit ?? 0), 0)
  const balanced = totalDebit === totalCredit

  return (
    <table className={cn("w-full border-collapse", className)}>
      <thead>
        <tr>
          <th className={cn(th, "w-[90px] text-left")}>科目代碼</th>
          <th className={cn(th, "text-left")}>科目</th>
          <th className={cn(th, "w-[110px] text-right")}>借方</th>
          <th className={cn(th, "w-[110px] text-right")}>貸方</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={`${entry.code}-${entry.account}`}>
            <td className={cn(td, "font-mono text-[11px] text-ink-2")}>{entry.code}</td>
            <td className={td}>{entry.account}</td>
            <td className={cn(td, "text-right font-mono tabular-nums")}>
              {entry.debit !== undefined ? fmt(entry.debit) : ""}
            </td>
            <td className={cn(td, "text-right font-mono tabular-nums")}>
              {entry.credit !== undefined ? fmt(entry.credit) : ""}
            </td>
          </tr>
        ))}
        <tr>
          <td className={cn(td, "border-t-2 border-t-line bg-head")} />
          <td className={cn(td, "border-t-2 border-t-line bg-head font-semibold")}>
            {balanced ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-ok">✓ 借貸平衡</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-er">
                ✕ 借貸不平衡
              </span>
            )}
          </td>
          <td
            className={cn(
              td,
              "border-t-2 border-t-line bg-head text-right font-mono font-semibold tabular-nums",
            )}
          >
            {fmt(totalDebit)}
          </td>
          <td
            className={cn(
              td,
              "border-t-2 border-t-line bg-head text-right font-mono font-semibold tabular-nums",
            )}
          >
            {fmt(totalCredit)}
          </td>
        </tr>
      </tbody>
    </table>
  )
}
