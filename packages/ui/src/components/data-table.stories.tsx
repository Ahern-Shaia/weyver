import type { Meta, StoryObj } from "@storybook/react"
import { Badge } from "./badge"
import { type Column, DataTable } from "./data-table"

interface PoRow {
  readonly no: string
  readonly supplier: string
  readonly amount: string
  readonly status: { readonly variant: "success" | "warning" | "info"; readonly label: string }
}

const rows: readonly PoRow[] = [
  {
    no: "PO-0716-001",
    supplier: "鑫豐農產品",
    amount: "128,400",
    status: { variant: "warning", label: "待審核" },
  },
  {
    no: "PO-0715-047",
    supplier: "統鮮實業",
    amount: "84,200",
    status: { variant: "success", label: "已核准" },
  },
  {
    no: "PO-0715-046",
    supplier: "正大食材",
    amount: "312,000",
    status: { variant: "info", label: "已收貨" },
  },
]

const columns: readonly Column<PoRow>[] = [
  {
    key: "no",
    header: "單號",
    render: (row) => <span className="font-mono text-[11px] text-brand-hover">{row.no}</span>,
  },
  { key: "supplier", header: "供應商", render: (row) => row.supplier },
  { key: "amount", header: "金額 NT$", align: "right", render: (row) => row.amount },
  {
    key: "status",
    header: "狀態",
    render: (row) => <Badge variant={row.status.variant}>{row.status.label}</Badge>,
  },
]

const meta = {
  title: "元件/DataTable 資料表",
  component: DataTable<PoRow>,
  args: { columns, data: rows, getRowKey: (row: PoRow) => row.no },
  parameters: { layout: "padded" },
} satisfies Meta<typeof DataTable<PoRow>>

export default meta
type Story = StoryObj<typeof meta>

export const PurchaseOrders: Story = {
  render: () => (
    <div className="w-[560px]">
      <DataTable columns={columns} data={rows} getRowKey={(row) => row.no} />
    </div>
  ),
}
