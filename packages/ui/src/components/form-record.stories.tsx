import type { Meta, StoryObj } from "@storybook/react-vite"
import { ApprovalTable } from "./approval-table"
import { FieldGrid } from "./field-grid"
import { FormSection } from "./form-section"
import { GlTable } from "./gl-table"
import { StatusBar, StatusBarDot } from "./status-bar"
import { SubTable, type SubTableColumn } from "./sub-table"
import { RecordNav, Toolbar } from "./toolbar"
import { Button } from "./button"

/* docs/14 v2 §3.2–3.9|表單記錄構件組合(主畫面) */
const meta = {
  title: "表單記錄/構件",
  parameters: { layout: "padded" },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const FieldGridStory: Story = {
  name: "FieldGrid 全框線欄位表",
  render: () => (
    <FormSection title="基本資料">
      <FieldGrid
        items={[
          { label: "單號", value: "PO-0716-001", mono: true, note: "自動編號" },
          { label: "單據日期", value: "2026-07-16", required: true, mono: true },
          { label: "採購人", value: "陳美玲" },
          { label: "當班批號", value: "BN-0716-A", mono: true, help: true },
        ]}
      />
    </FormSection>
  ),
}

interface Li {
  readonly item: string
  readonly qty: number
  readonly subtotal: string
}
const liCols: readonly SubTableColumn<Li>[] = [
  { key: "item", header: "品項", render: (r) => r.item },
  { key: "qty", header: "數量", align: "right", width: "70px", render: (r) => r.qty },
  { key: "subtotal", header: "小計 fx", align: "right", width: "96px", render: (r) => r.subtotal },
]

export const SubTableStory: Story = {
  name: "SubTable 子表(列號+合計)",
  render: () => (
    <FormSection title="採購明細" hint="子表 · Link & Load 帶入">
      <SubTable
        columns={liCols}
        data={[
          { item: "凍覆盆子 500g", qty: 200, subtotal: "80,250" },
          { item: "凍覆盆子 1kg", qty: 80, subtotal: "32,100" },
        ]}
        getRowKey={(r) => r.item}
        sumLabel="總計(fx = Σ)"
        sumRow={{ qty: "280", subtotal: "112,350" }}
      />
    </FormSection>
  ),
}

export const ApprovalStory: Story = {
  name: "ApprovalTable 簽核表",
  render: () => (
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
          { seq: 3, approver: "王淑芬", role: "財務", result: { tone: "neutral", label: "待審" } },
        ]}
      />
    </FormSection>
  ),
}

export const GlStory: Story = {
  name: "GlTable 借貸過帳(平衡斷言)",
  render: () => (
    <FormSection title="會計過帳(預覽)" hint="期間 2026-07(未鎖)">
      <GlTable
        entries={[
          { code: "1130", account: "存貨 — 原物料", debit: 128400 },
          { code: "2110", account: "應付帳款 — 鑫豐農產品", credit: 128400 },
        ]}
      />
    </FormSection>
  ),
}

export const ToolbarStory: Story = {
  name: "Toolbar + RecordNav",
  render: () => (
    <div className="border border-line">
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
        <Button>列印 ▾</Button>
      </Toolbar>
    </div>
  ),
}

export const StatusBarStory: Story = {
  name: "StatusBar 狀態列",
  render: () => (
    <div className="border border-line">
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
          </>
        }
        right={
          <span>
            Weyver <b className="font-mono font-medium text-ink-2">R1</b>
          </span>
        }
      />
    </div>
  ),
}
