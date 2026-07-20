"use client"

import { ApprovalTable } from "@weyver/ui/approval-table"
import { FieldGrid } from "@weyver/ui/field-grid"
import { FormSection } from "@weyver/ui/form-section"
import { GlTable } from "@weyver/ui/gl-table"
import { StatusChip } from "@weyver/ui/status-chip"
import { SubTable, type SubTableColumn } from "@weyver/ui/sub-table"
import { PO_LINES, type PoLine, fmt } from "./po-data"

/* S4 表單記錄(主畫面):文件式表單(docs/24)*/
const LINE_COLUMNS: readonly SubTableColumn<PoLine>[] = [
  { key: "item", header: "品項", render: (row) => row.item },
  { key: "spec", header: "規格", render: (row) => row.spec },
  { key: "qty", header: "數量", align: "right", width: "70px", render: (row) => fmt(row.qty) },
  { key: "price", header: "單價", align: "right", width: "86px", render: (row) => fmt(row.price) },
  {
    key: "subtotal",
    header: "小計 fx",
    align: "right",
    width: "96px",
    render: (row) => fmt(row.qty * row.price),
  },
]

export function PoFormView() {
  const totalQty = PO_LINES.reduce((sum, line) => sum + line.qty, 0)
  const totalAmount = PO_LINES.reduce((sum, line) => sum + line.qty * line.price, 0)

  return (
    <div className="flex-1 overflow-y-auto py-4 pb-8">
      <div className="mx-auto flex max-w-[880px] flex-col gap-3 px-5">
        <div className="flex items-baseline gap-3 rounded-md border border-line bg-card px-4 py-3.5 shadow-xs">
          <h1 className="text-lg font-semibold tracking-tight">採購單</h1>
          <span className="font-mono text-[15px] font-semibold text-primary">PO-0716-001</span>
          <StatusChip tone="warn">待審核</StatusChip>
          <div className="ml-auto text-right text-[11px] leading-normal text-ink-3">
            建立 <b className="font-mono font-medium text-ink-2">2026-07-16 09:12</b> 陳美玲
            <br />
            最後更新 <b className="font-mono font-medium text-ink-2">2026-07-16 14:03</b> 林志豪
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
            data={PO_LINES}
            getRowKey={(row) => row.item}
            sumLabel={
              <>
                總計<span className="font-normal opacity-75">(fx = Σ 小計)</span>
              </>
            }
            sumRow={{ qty: fmt(totalQty), subtotal: fmt(totalAmount) }}
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
              { code: "1130", account: "存貨 — 原物料", debit: totalAmount },
              { code: "2110", account: "應付帳款 — 鑫豐農產品", credit: totalAmount },
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
                  <a href="#audit" className="text-[11px] text-link underline underline-offset-2">
                    檢視 12 筆變更
                  </a>
                ),
              },
            ]}
          />
        </FormSection>
      </div>
    </div>
  )
}
