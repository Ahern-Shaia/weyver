"use client"

import { ApprovalTable } from "@weyver/ui/approval-table"
import { Button } from "@weyver/ui/button"
import { FieldGrid } from "@weyver/ui/field-grid"
import { FormSection } from "@weyver/ui/form-section"
import { GlTable } from "@weyver/ui/gl-table"
import { RecordRail, type RecordRailItem } from "@weyver/ui/record-rail"
import { Segmented } from "@weyver/ui/segmented"
import { StatusBar, StatusBarDot } from "@weyver/ui/status-bar"
import { StatusChip } from "@weyver/ui/status-chip"
import { SubTable, type SubTableColumn } from "@weyver/ui/sub-table"
import { ThemeSwitcher } from "@weyver/ui/theme-switcher"
import { Toolbar, RecordNav } from "@weyver/ui/toolbar"
import { TopBar } from "@weyver/ui/top-bar"
import { useState } from "react"

const TABS = [
  { id: "purchase", label: "採購" },
  { id: "sales", label: "銷售" },
  { id: "inventory", label: "庫存" },
  { id: "mes", label: "生產現場" },
  { id: "iso", label: "品保 ISO" },
  { id: "finance", label: "財會" },
  { id: "reports", label: "報表" },
] as const

const RECORDS: readonly RecordRailItem[] = [
  {
    id: "1",
    code: "PO-0716-001",
    amount: "128,400",
    title: "凍覆盆子 500g",
    status: { tone: "warn", label: "待審核" },
    meta: "鑫豐農產品 · 07/22 交",
  },
  {
    id: "2",
    code: "PO-0715-047",
    amount: "84,200",
    title: "凍藍莓 500g",
    status: { tone: "ok", label: "已核准" },
    meta: "統鮮實業 · 07/20 交",
  },
  {
    id: "3",
    code: "PO-0715-046",
    amount: "312,000",
    title: "綜合莓果 1kg",
    status: { tone: "neutral", label: "已收貨" },
    meta: "正大食材 · 07/19 交",
  },
  {
    id: "4",
    code: "PO-0715-045",
    amount: "56,800",
    title: "凍草莓 500g",
    status: { tone: "ok", label: "已核准" },
    meta: "永豐冷鏈 · 07/18 交",
  },
  {
    id: "5",
    code: "PO-0715-044",
    amount: "100,800",
    title: "冷凍芒果丁 1kg",
    status: { tone: "error", label: "退回" },
    meta: "鑫豐農產品 · 07/18 交",
  },
]

interface LineItem {
  readonly item: string
  readonly spec: string
  readonly qty: number
  readonly price: string
  readonly subtotal: string
}

const LINE_ITEMS: readonly LineItem[] = [
  { item: "凍覆盆子 500g", spec: "冷凍 -18°C", qty: 200, price: "401.25", subtotal: "80,250" },
  { item: "凍覆盆子 1kg", spec: "冷凍 -18°C", qty: 80, price: "401.25", subtotal: "32,100" },
  { item: "覆盆子果醬底料", spec: "桶裝 5kg", qty: 40, price: "401.25", subtotal: "16,050" },
]

const LINE_COLUMNS: readonly SubTableColumn<LineItem>[] = [
  { key: "item", header: "品項", render: (row) => row.item },
  { key: "spec", header: "規格", render: (row) => row.spec },
  { key: "qty", header: "數量", align: "right", width: "70px", render: (row) => row.qty },
  { key: "price", header: "單價", align: "right", width: "86px", render: (row) => row.price },
  {
    key: "subtotal",
    header: "小計 fx",
    align: "right",
    width: "96px",
    render: (row) => row.subtotal,
  },
]

export default function AppDemoPage() {
  const [activeTab, setActiveTab] = useState<string>("purchase")
  const [activeRecord, setActiveRecord] = useState("1")
  const [view, setView] = useState("form")

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        tabs={TABS}
        activeTab={activeTab}
        onTabSelect={setActiveTab}
        right={
          <>
            <ThemeSwitcher />
            <span className="text-[11.5px] text-ink-2">
              <b className="font-semibold">鮮勇食品</b> · 陳美玲
            </span>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <RecordRail
          header={
            <div>
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                採購單
                <span className="ml-auto rounded-xs border border-current px-1 text-[9px] font-semibold text-fx">
                  GL 連動
                </span>
              </div>
              <div className="mt-[7px]">
                <Segmented
                  ariaLabel="檢視"
                  value={view}
                  onValueChange={setView}
                  options={[
                    { label: "表單", value: "form" },
                    { label: "列表", value: "list" },
                  ]}
                />
              </div>
            </div>
          }
          items={RECORDS}
          activeId={activeRecord}
          onSelect={setActiveRecord}
          footer={
            <>
              <span>
                共 <b className="font-mono font-semibold text-ink-2">248</b> 筆
              </span>
              <span>
                本月 <b className="font-mono font-semibold text-ink-2">32</b> 筆
              </span>
            </>
          }
        />

        <div className="flex min-w-0 flex-1 flex-col bg-surface">
          <Toolbar
            crumb={
              <>
                採購 › <b className="font-medium text-ink-2">採購單</b>
              </>
            }
            right={<RecordNav index={1} total={248} />}
          >
            <Button variant="primary">核准並過帳</Button>
            <Button>儲存</Button>
            <Button>新增</Button>
            <Button>列印 ▾</Button>
            <Button>表單工具 ▾</Button>
          </Toolbar>

          <div className="flex-1 overflow-y-auto py-3.5 pb-8">
            <div className="mx-auto max-w-[880px] px-5">
              <div className="flex items-baseline gap-3 border border-b-0 border-line bg-card px-4 py-3">
                <h1 className="text-lg font-semibold tracking-tight">採購單</h1>
                <span className="font-mono text-[15px] font-semibold text-primary">
                  PO-0716-001
                </span>
                <StatusChip tone="warn">待審核</StatusChip>
                <div className="ml-auto text-right text-[11px] leading-normal text-ink-3">
                  建立 <b className="font-mono font-medium text-ink-2">2026-07-16 09:12</b> 陳美玲
                  <br />
                  最後更新 <b className="font-mono font-medium text-ink-2">2026-07-16 14:03</b>{" "}
                  林志豪
                </div>
              </div>

              <FormSection title="基本資料">
                <FieldGrid
                  items={[
                    { label: "單號", value: "PO-0716-001", mono: true, note: "自動編號" },
                    { label: "單據日期", value: "2026-07-16", required: true, mono: true },
                    { label: "採購人", value: "陳美玲" },
                    { label: "部門", value: "採購部" },
                    { label: "倉別", value: "冷凍倉 A" },
                    { label: "當班批號", value: "BN-0716-A", mono: true, help: true },
                  ]}
                />
              </FormSection>

              <FormSection title="供應商與交貨" hint="Link & Load 帶入供應商主檔">
                <FieldGrid
                  items={[
                    {
                      label: "供應商",
                      value: (
                        <a href="#supplier" className="text-link underline underline-offset-2">
                          鑫豐農產品
                        </a>
                      ),
                      required: true,
                      note: "S-0032",
                    },
                    { label: "交期", value: "2026-07-22", mono: true },
                    { label: "聯絡人", value: "陳美玲 · 0912-345-678" },
                    { label: "付款條件", value: "月結 30 天" },
                    { label: "統一編號", value: "24536718", mono: true },
                    { label: "運送方式", value: "冷鏈宅配" },
                  ]}
                />
              </FormSection>

              <FormSection title="採購明細" hint="子表 · 單價自商品主檔帶入">
                <SubTable
                  columns={LINE_COLUMNS}
                  data={LINE_ITEMS}
                  getRowKey={(row) => row.item}
                  sumLabel={
                    <>
                      總計<span className="font-normal opacity-75">(fx = Σ 小計)</span>
                    </>
                  }
                  sumRow={{ qty: "320", subtotal: "128,400" }}
                  onAddRow={() => undefined}
                />
              </FormSection>

              <FormSection title="簽核流程" hint="3 關卡 · 依序">
                <ApprovalTable
                  rows={[
                    {
                      seq: 1,
                      approver: "陳美玲",
                      role: "申請人",
                      result: { tone: "ok", label: "已送出" },
                      time: "07-16 09:12",
                    },
                    {
                      seq: 2,
                      approver: "林志豪",
                      role: "採購主管",
                      result: { tone: "warn", label: "審核中" },
                    },
                    {
                      seq: 3,
                      approver: "王淑芬",
                      role: "財務",
                      result: { tone: "neutral", label: "待審" },
                    },
                  ]}
                />
              </FormSection>

              <FormSection title="會計過帳(預覽)" hint="審核通過後自動過帳 · 期間 2026-07(未鎖)">
                <GlTable
                  entries={[
                    { code: "1130", account: "存貨 — 原物料", debit: 128400 },
                    { code: "2110", account: "應付帳款 — 鑫豐農產品", credit: 128400 },
                  ]}
                />
              </FormSection>

              <FormSection title="系統資訊">
                <FieldGrid
                  items={[
                    { label: "建立", value: "2026-07-16 09:12:44 · 陳美玲", mono: true },
                    { label: "最後更新", value: "2026-07-16 14:03:21 · 林志豪", mono: true },
                    {
                      label: "版本",
                      value: (
                        <>
                          <span className="font-mono">v3</span>
                          <a
                            href="#history"
                            className="text-[11px] text-link underline underline-offset-2"
                          >
                            (歷史 / 還原)
                          </a>
                        </>
                      ),
                    },
                    {
                      label: "稽核記錄",
                      value: (
                        <a
                          href="#audit"
                          className="text-[11px] text-link underline underline-offset-2"
                        >
                          檢視 12 筆變更
                        </a>
                      ),
                    },
                  ]}
                />
              </FormSection>
            </div>
          </div>

          <StatusBar
            left={
              <>
                <span>
                  <StatusBarDot />
                  已連線 · 即時同步
                </span>
                <span>
                  資料更新 <b className="font-mono font-medium text-ink-2">14:03:21</b>
                </span>
                <span>
                  租戶 <b className="font-mono font-medium text-ink-2">hsienyung</b>
                </span>
              </>
            }
            right={
              <>
                <span>權限:採購 — 完整</span>
                <span>
                  Weyver <b className="font-mono font-medium text-ink-2">R1</b>
                </span>
              </>
            }
          />
        </div>
      </div>
    </div>
  )
}
