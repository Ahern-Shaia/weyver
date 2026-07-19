"use client"

import { ListView } from "@weyver/ui/list-view"
import { StatusChip } from "@weyver/ui/status-chip"
import type { ColumnDef } from "@tanstack/react-table"
import { PO_RECORDS, type PoRecord } from "./po-data"

/* S5 列表視圖(TanStack Table):可排序;點列 → 開該筆表單 */
const columns: readonly ColumnDef<PoRecord, unknown>[] = [
  {
    accessorKey: "code",
    header: "單號",
    cell: (info) => (
      <span className="font-mono text-[11px] text-ink-2">{info.getValue<string>()}</span>
    ),
  },
  { accessorKey: "supplier", header: "供應商" },
  { accessorKey: "item", header: "品項" },
  { accessorKey: "qty", header: "數量", meta: { align: "right" } },
  { accessorKey: "price", header: "單價", meta: { align: "right" } },
  {
    accessorKey: "amount",
    header: "金額 NT$",
    meta: { align: "right" },
    cell: (info) => <span className="font-semibold">{info.getValue<string>()}</span>,
  },
  {
    accessorKey: "batch",
    header: "批號",
    cell: (info) => (
      <span className="font-mono text-[11px] text-ink-2">{info.getValue<string>()}</span>
    ),
  },
  { accessorKey: "due", header: "交期", meta: { align: "right" } },
  {
    accessorKey: "status",
    header: "狀態",
    enableSorting: false,
    cell: (info) => {
      const status = info.getValue<PoRecord["status"]>()
      return <StatusChip tone={status.tone}>{status.label}</StatusChip>
    },
  },
]

export function PoListView({
  selectedId,
  onOpenRecord,
}: {
  readonly selectedId: string
  readonly onOpenRecord: (id: string) => void
}) {
  return (
    <div className="p-3.5">
      <ListView
        data={PO_RECORDS}
        columns={columns}
        getRowId={(row) => row.id}
        selectedId={selectedId}
        onRowClick={onOpenRecord}
      />
      <p className="mt-1.5 text-[10.5px] text-ink-4">
        點欄頭排序 · 點列開啟該筆表單記錄 · 共 {PO_RECORDS.length} 筆(展示資料)
      </p>
    </div>
  )
}
