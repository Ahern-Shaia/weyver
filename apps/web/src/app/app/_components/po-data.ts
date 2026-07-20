import type { RecordRailItem } from "@weyver/ui/record-rail"
import type { StatusTone } from "@weyver/ui/status-chip"

export interface PoRecord {
  readonly id: string
  readonly code: string
  readonly supplier: string
  readonly item: string
  readonly qty: number
  readonly price: string
  readonly amount: string
  readonly batch: string
  readonly due: string
  readonly status: { readonly tone: StatusTone; readonly label: string }
}

export const PO_RECORDS: readonly PoRecord[] = [
  {
    id: "1",
    code: "PO-0716-001",
    supplier: "鑫豐農產品",
    item: "凍覆盆子 500g",
    qty: 320,
    price: "401.25",
    amount: "128,400",
    batch: "BN-0716-A",
    due: "07/22",
    status: { tone: "warn", label: "待審核" },
  },
  {
    id: "2",
    code: "PO-0715-047",
    supplier: "統鮮實業",
    item: "凍藍莓 500g",
    qty: 200,
    price: "421.00",
    amount: "84,200",
    batch: "BN-0715-C",
    due: "07/20",
    status: { tone: "neutral", label: "已核准" },
  },
  {
    id: "3",
    code: "PO-0715-046",
    supplier: "正大食材",
    item: "綜合莓果 1kg",
    qty: 150,
    price: "2,080.00",
    amount: "312,000",
    batch: "BN-0715-B",
    due: "07/19",
    status: { tone: "neutral", label: "已收貨" },
  },
  {
    id: "4",
    code: "PO-0715-045",
    supplier: "永豐冷鏈",
    item: "凍草莓 500g",
    qty: 140,
    price: "405.71",
    amount: "56,800",
    batch: "BN-0715-K",
    due: "07/18",
    status: { tone: "neutral", label: "已核准" },
  },
  {
    id: "5",
    code: "PO-0715-044",
    supplier: "鑫豐農產品",
    item: "冷凍芒果丁 1kg",
    qty: 90,
    price: "1,120.00",
    amount: "100,800",
    batch: "BN-0715-A",
    due: "07/18",
    status: { tone: "error", label: "退回" },
  },
  {
    id: "6",
    code: "PO-0714-039",
    supplier: "統鮮實業",
    item: "凍鳳梨塊 500g",
    qty: 260,
    price: "288.46",
    amount: "75,000",
    batch: "BN-0714-D",
    due: "07/17",
    status: { tone: "neutral", label: "已收貨" },
  },
  {
    id: "7",
    code: "PO-0714-038",
    supplier: "正大食材",
    item: "冷凍蔬菜包 2kg",
    qty: 75,
    price: "640.00",
    amount: "48,000",
    batch: "BN-0714-B",
    due: "07/16",
    status: { tone: "neutral", label: "已核准" },
  },
]

export const RAIL_ITEMS: readonly RecordRailItem[] = PO_RECORDS.slice(0, 5).map((record) => ({
  id: record.id,
  code: record.code,
  amount: record.amount,
  title: record.item,
  status: record.status,
  meta: `${record.supplier} · ${record.due} 交`,
}))

export interface PoLine {
  item: string
  spec: string
  qty: number
  price: number
}

export const PO_LINES: readonly PoLine[] = [
  { item: "凍覆盆子 500g", spec: "冷凍 -18°C", qty: 200, price: 401.25 },
  { item: "凍覆盆子 1kg", spec: "冷凍 -18°C", qty: 80, price: 401.25 },
  { item: "覆盆子果醬底料", spec: "桶裝 5kg", qty: 40, price: 401.25 },
]

export const fmt = (value: number): string =>
  value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })
