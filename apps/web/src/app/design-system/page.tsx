"use client"

import { ApprovalTable } from "@weyver/ui/approval-table"
import { Button } from "@weyver/ui/button"
import { type Column, DataTable } from "@weyver/ui/data-table"
import { FieldGrid } from "@weyver/ui/field-grid"
import { FormSection } from "@weyver/ui/form-section"
import { GlTable } from "@weyver/ui/gl-table"
import { Input } from "@weyver/ui/input"
import { Segmented } from "@weyver/ui/segmented"
import { StatusBar, StatusBarDot } from "@weyver/ui/status-bar"
import { StatusChip } from "@weyver/ui/status-chip"
import { SubTable, type SubTableColumn } from "@weyver/ui/sub-table"
import { THEMES, ThemeSwitcher } from "@weyver/ui/theme-switcher"
import { RecordNav, Toolbar } from "@weyver/ui/toolbar"
import { Search } from "lucide-react"
import { type ReactNode, useState } from "react"

function Section({
  title,
  desc,
  children,
}: {
  readonly title: string
  readonly desc?: string
  readonly children: ReactNode
}) {
  return (
    <section className="mb-9">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      {desc ? (
        <p className="mt-0.5 mb-3 max-w-[620px] text-[12px] text-ink-3">{desc}</p>
      ) : (
        <div className="mb-3" />
      )}
      {children}
    </section>
  )
}

const neutrals = [
  ["surface", "#E8EAED"],
  ["card", "#FFFFFF"],
  ["head", "#F2F4F6"],
  ["label", "#EEF1F4"],
  ["line", "#C9CFD6"],
  ["cell", "#D5DAE0"],
  ["ink", "#14181D"],
  ["ink-3", "#6B7684"],
] as const

interface PoRow {
  readonly no: string
  readonly supplier: string
  readonly amount: string
}
const poRows: readonly PoRow[] = [
  { no: "PO-0716-001", supplier: "鑫豐農產品", amount: "128,400" },
  { no: "PO-0715-047", supplier: "統鮮實業", amount: "84,200" },
  { no: "PO-0715-046", supplier: "正大食材", amount: "312,000" },
]
const poColumns: readonly Column<PoRow>[] = [
  {
    key: "no",
    header: "單號",
    render: (r) => <span className="font-mono text-[12px] text-ink-2">{r.no}</span>,
  },
  { key: "supplier", header: "供應商", render: (r) => r.supplier },
  { key: "amount", header: "金額 NT$", align: "right", render: (r) => r.amount },
]

interface Li {
  readonly item: string
  readonly qty: number
  readonly subtotal: string
}
const liData: readonly Li[] = [
  { item: "凍覆盆子 500g", qty: 200, subtotal: "80,250" },
  { item: "凍覆盆子 1kg", qty: 80, subtotal: "32,100" },
]
const liCols: readonly SubTableColumn<Li>[] = [
  { key: "item", header: "品項", render: (r) => r.item },
  { key: "qty", header: "數量", align: "right", width: "70px", render: (r) => r.qty },
  { key: "subtotal", header: "小計 fx", align: "right", width: "96px", render: (r) => r.subtotal },
]

export default function DesignSystemPage() {
  const [seg, setSeg] = useState("form")

  return (
    <div className="mx-auto max-w-[960px] px-6 py-8">
      <header className="mb-8 border border-line bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-sm bg-primary text-[13px] font-bold text-white">
            W
          </div>
          <div>
            <h1 className="text-[16px] font-semibold">Weyver 設計系統 v2.1</h1>
            <p className="text-[12px] text-ink-3">
              嚴謹企業級(docs/14 v2.1)· 全框線 · 方角 · 禁陰影 · IBM Plex · 12.5px 密度
            </p>
          </div>
          <ThemeSwitcher className="ml-auto" />
        </div>
      </header>

      <Section
        title="三配色主題"
        desc="一套系統,[data-theme] 語意 token 切換;結構/狀態/功能色跨主題共用。右上切換全頁生效。"
      >
        <div className="flex gap-2.5">
          {THEMES.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 border border-line bg-card px-3 py-2"
            >
              {/* 色塊掛 data-theme 吃 var(--color-primary) —— 顯示的一定是該主題的真實主色。
                  原本這裡印死的 hex 與 tokens.css 已經不同步,設計系統頁反而在騙人。 */}
              <span
                className="size-5 rounded-xs border border-line bg-primary"
                {...(t.id === "thread" ? {} : { "data-theme": t.id })}
              />
              <div>
                <div className="text-[12px] font-semibold">{t.label}</div>
                <div className="font-mono text-[12px] text-ink-3">{t.id}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="結構中性色" desc="深度靠框線(line/cell),禁陰影。">
        <div className="grid grid-cols-8 gap-1.5">
          {neutrals.map(([name, hex]) => (
            <div key={name} className="border border-line bg-card">
              <div className="h-9 border-b border-line-2" style={{ backgroundColor: hex }} />
              <div className="px-1.5 py-1">
                <div className="text-[12px] font-semibold">{name}</div>
                <div className="font-mono text-[12px] text-ink-3">{hex}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="按鈕與工具列" desc="帶框按鈕 27px;每畫面單一 primary;記錄導航必備。">
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
            <Button variant="danger">作廢</Button>
          </Toolbar>
        </div>
      </Section>

      <Section title="狀態章" desc="帶框方形(字/框/底三值),文字必有;禁 pill。">
        <div className="flex items-center gap-2 border border-line bg-card p-3">
          <StatusChip tone="ok">已核准</StatusChip>
          <StatusChip tone="warn">待審核</StatusChip>
          <StatusChip tone="error">退回</StatusChip>
          <StatusChip tone="neutral">已收貨</StatusChip>
        </div>
      </Section>

      <Section title="輸入與分段切換">
        <div className="flex items-center gap-3 border border-line bg-card p-3">
          <Input
            className="w-56"
            placeholder="搜尋 表單 · 記錄 · 欄位"
            icon={<Search strokeWidth={1.5} />}
          />
          <Segmented
            ariaLabel="檢視"
            value={seg}
            onValueChange={setSeg}
            options={[
              { label: "表單", value: "form" },
              { label: "列表", value: "list" },
            ]}
          />
        </div>
      </Section>

      <Section
        title="表單記錄構件"
        desc="主畫面 = 文件式表單(docs/24):分段條 + 全框線欄位表 + 子表 + 簽核表 + GL 過帳。"
      >
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
        <FormSection title="採購明細" hint="子表 · Link & Load 帶入">
          <SubTable
            columns={liCols}
            data={liData}
            getRowKey={(r) => r.item}
            sumLabel={
              <>
                總計<span className="font-normal opacity-75">(fx = Σ)</span>
              </>
            }
            sumRow={{ qty: "280", subtotal: "112,350" }}
          />
        </FormSection>
        <FormSection title="簽核流程" hint="表格式 + 時間戳">
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
            ]}
          />
        </FormSection>
        <FormSection title="會計過帳(預覽)" hint="科目代碼 + 借貸平衡斷言">
          <GlTable
            entries={[
              { code: "1130", account: "存貨 — 原物料", debit: 128400 },
              { code: "2110", account: "應付帳款 — 鑫豐農產品", credit: 128400 },
            ]}
          />
        </FormSection>
      </Section>

      <Section title="列表(次要視圖)" desc="hairline、表頭 head 底、數字右對齊 Mono、禁斑馬。">
        <DataTable
          columns={poColumns}
          data={poRows}
          getRowKey={(r) => r.no}
          selectedKey="PO-0716-001"
        />
      </Section>

      <Section title="狀態列" desc="連線 · 同步時間戳 · 租戶 · 權限 · 版本(信任訊號)。">
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
                <span>
                  租戶 <b className="font-mono font-medium text-ink-2">hsienyung</b>
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
      </Section>

      <p className="text-[12px] text-ink-3">
        完整規則見 docs/14 v2.1;flagship 展示見{" "}
        <a href="/app" className="text-link underline underline-offset-2">
          /app 表單記錄
        </a>
        。
      </p>
    </div>
  )
}
