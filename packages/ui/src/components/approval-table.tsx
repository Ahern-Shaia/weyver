import type { ReactElement, ReactNode } from "react"
import { StatusChip, type StatusTone } from "./status-chip"

/* docs/14 v2 §3.4|簽核=表格(順序/簽核人/角色/結果/時間/意見),不用頭像流程圖 */
export interface ApprovalRow {
  readonly seq: number
  readonly approver: string
  readonly role: string
  readonly result: { readonly tone: StatusTone; readonly label: string }
  readonly time?: string
  readonly comment?: ReactNode
}

export interface ApprovalTableProps {
  readonly rows: readonly ApprovalRow[]
  readonly className?: string
}

const th =
  "border border-t-0 border-cell bg-head px-2 py-[5px] text-left text-[10.5px] font-semibold text-ink-2"
const td = "border border-cell px-2 py-[5px] text-[12px]"

export function ApprovalTable({ rows, className }: ApprovalTableProps): ReactElement {
  return (
    <table className={`w-full border-collapse ${className ?? ""}`}>
      <thead>
        <tr>
          <th className={`${th} w-11`}>順序</th>
          <th className={th}>簽核人</th>
          <th className={th}>角色</th>
          <th className={`${th} w-[90px]`}>結果</th>
          <th className={`${th} w-[140px]`}>時間</th>
          <th className={th}>意見</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.seq}>
            <td className={`${td} font-mono text-[11px]`}>{row.seq}</td>
            <td className={td}>{row.approver}</td>
            <td className={td}>{row.role}</td>
            <td className={td}>
              <StatusChip tone={row.result.tone}>{row.result.label}</StatusChip>
            </td>
            <td className={`${td} font-mono text-[11px] tabular-nums`}>{row.time ?? "—"}</td>
            <td className={td}>{row.comment ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
