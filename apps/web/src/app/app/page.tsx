import { AppShell, type NavSection } from "@weyver/ui/app-shell"
import { Badge } from "@weyver/ui/badge"
import { Button } from "@weyver/ui/button"
import { type Column, DataTable } from "@weyver/ui/data-table"
import { Kpi } from "@weyver/ui/kpi"
import { ModuleCard } from "@weyver/ui/module-card"
import {
  Boxes,
  ClipboardCheck,
  Download,
  FileText,
  LayoutDashboard,
  Package,
  ShoppingCart,
} from "lucide-react"

const nav: readonly NavSection[] = [
  {
    items: [{ icon: <LayoutDashboard />, label: "總覽", active: true }],
  },
  {
    label: "模組",
    items: [
      { icon: <FileText />, label: "表單引擎", meta: "247" },
      { icon: <ShoppingCart />, label: "採購", meta: "18" },
      { icon: <Package />, label: "庫存" },
      { icon: <Boxes />, label: "MES 現場", meta: "3" },
      { icon: <ClipboardCheck />, label: "ISO 品管" },
    ],
  },
]

interface PoRow {
  readonly no: string
  readonly supplier: string
  readonly amount: string
  readonly status: { readonly variant: "success" | "warning" | "info"; readonly label: string }
}

const poRows: readonly PoRow[] = [
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
  {
    no: "PO-0715-045",
    supplier: "永豐冷鏈",
    amount: "56,800",
    status: { variant: "success", label: "已核准" },
  },
]

const poColumns: readonly Column<PoRow>[] = [
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

export default function AppDemoPage() {
  return (
    <AppShell tenantName="鮮勇工作區" nav={nav}>
      <div className="mb-5 flex items-end justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.4px]">總覽</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            資料更新於 <span className="font-mono tabular-nums">2026-07-18 21:40</span> · 即時同步
          </p>
        </div>
        <Button variant="secondary">
          <Download className="size-3.5" strokeWidth={1.6} />
          匯出
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <Kpi label="本月銷售" value="4.82" unit="M" trend={{ direction: "up", label: "12.3%" }} />
        <Kpi label="整體 OEE" value="87" unit="%" note={{ tone: "muted", label: "3 線運行" }} />
        <Kpi label="待我處理" value="8" note={{ tone: "danger", label: "2 件今日到期" }} />
        <Kpi label="在製工單" value="24" note={{ tone: "muted", label: "本週 +6" }} />
      </div>

      <h2 className="mb-3 text-[13px] font-semibold">模組一站式</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <ModuleCard
          icon={<FileText strokeWidth={1.5} />}
          name="表單引擎"
          meta="247 張表單 · 1.2 萬筆"
        />
        <ModuleCard icon={<ShoppingCart strokeWidth={1.5} />} name="採購" meta="18 張待處理" />
        <ModuleCard
          icon={<Boxes strokeWidth={1.5} />}
          name="MES 現場"
          meta="3 線運行"
          value="87%"
        />
      </div>

      <h2 className="mb-3 text-[13px] font-semibold">近期採購單</h2>
      <DataTable columns={poColumns} data={poRows} getRowKey={(row) => row.no} />
    </AppShell>
  )
}
