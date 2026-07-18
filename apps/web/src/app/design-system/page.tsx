"use client"

import { Badge } from "@weyver/ui/badge"
import { Button } from "@weyver/ui/button"
import { type Column, DataTable } from "@weyver/ui/data-table"
import { Input } from "@weyver/ui/input"
import { Kpi } from "@weyver/ui/kpi"
import { ModuleCard } from "@weyver/ui/module-card"
import { Segmented } from "@weyver/ui/segmented"
import { Boxes, FileText, Plus, Search } from "lucide-react"
import { type ReactNode, useState } from "react"

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

const tealScale = [
  { name: "teal-900", cls: "bg-teal-900", hex: "#073B47" },
  { name: "brand · 800", cls: "bg-brand", hex: "#0C5F73" },
  { name: "teal-700", cls: "bg-teal-700", hex: "#0E7490" },
  { name: "teal-400", cls: "bg-teal-400", hex: "#3AA9BE" },
  { name: "tint · 50", cls: "bg-brand-tint", hex: "#EAF3F5" },
]

const inkScale = [
  { name: "ink", cls: "bg-ink", hex: "#181E26" },
  { name: "ink-2", cls: "bg-ink-2", hex: "#586069" },
  { name: "ink-3", cls: "bg-ink-3", hex: "#868E98" },
  { name: "border", cls: "bg-border", hex: "#E2E7EB" },
  { name: "bg", cls: "bg-surface", hex: "#F4F6F8" },
]

const semantic = [
  { name: "Success", cls: "bg-success", use: "完成 · 合格 · 運行", hex: "#0E9E5B" },
  { name: "Warning", cls: "bg-warning", use: "警示 · 近期到期", hex: "#C8760C" },
  { name: "Danger", cls: "bg-danger", use: "異常 · 超限", hex: "#D23B32" },
  { name: "Info", cls: "bg-info", use: "採購 · 系統提示", hex: "#2E6FE0" },
  { name: "Accent", cls: "bg-accent", use: "ISO · 文件", hex: "#6D45C9" },
]

const typeScale = [
  {
    spec: "28 / 700",
    cls: "text-[28px] font-bold tracking-[-0.7px]",
    label: "Display · 頁面英雄數字",
  },
  { spec: "20 / 650", cls: "text-[20px] font-semibold tracking-[-0.4px]", label: "H1 · 頁面標題" },
  { spec: "17 / 650", cls: "text-[17px] font-semibold", label: "H2 · 區塊標題" },
  { spec: "13 / 650", cls: "text-[13px] font-semibold", label: "Section · 面板標題" },
  { spec: "14 / 400", cls: "text-[14px]", label: "Body · 內文段落文字" },
  { spec: "12.5 / 450", cls: "text-[12.5px]", label: "Small · 表格 · 次要文字" },
]

function Section({
  id,
  title,
  desc,
  children,
}: {
  readonly id: string
  readonly title: string
  readonly desc: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <section id={id} className="mb-13 scroll-mt-6">
      <h2 className="mb-1.5 text-[20px] font-semibold tracking-[-0.4px]">{title}</h2>
      <p className="mb-5 max-w-[640px] text-[13.5px] leading-relaxed text-ink-2">{desc}</p>
      {children}
    </section>
  )
}

function Panel({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="rounded-md border border-border bg-card p-5">{children}</div>
}

const tocLinks = [
  {
    group: "基礎",
    items: [
      ["color", "色彩"],
      ["type", "字型"],
      ["tokens", "間距 · 圓角 · 陰影"],
    ],
  },
  {
    group: "元件",
    items: [
      ["buttons", "按鈕"],
      ["badges", "狀態標籤"],
      ["controls", "輸入 · 控制"],
      ["data", "資料元件"],
    ],
  },
  { group: "規範", items: [["dodont", "Do & Don't"]] },
] as const

export default function DesignSystemPage(): ReactNode {
  const [period, setPeriod] = useState("today")

  return (
    <div className="mx-auto grid max-w-[1200px] grid-cols-[200px_1fr]">
      <nav className="sticky top-0 h-screen self-start overflow-y-auto border-r border-border px-4 py-7">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-[30px] items-center justify-center rounded-sm bg-brand text-[15px] font-bold tracking-tight text-white">
            W
          </div>
          <div className="text-[14px] font-semibold leading-tight tracking-tight">
            Weyver
            <small className="block text-[10px] font-normal text-ink-3">設計系統 v1</small>
          </div>
        </div>
        {tocLinks.map((section) => (
          <div key={section.group} className="mb-3">
            <div className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-ink-4">
              {section.group}
            </div>
            {section.items.map(([anchor, label]) => (
              <a
                key={anchor}
                href={`#${anchor}`}
                className="block rounded-sm px-2.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:bg-surface hover:text-ink"
              >
                {label}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <div className="px-11 pb-20 pt-10">
        <div className="mb-13 rounded-lg border border-border bg-card px-8 py-8">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-brand">
            Brand Identity · Design System
          </div>
          <h1 className="text-[30px] font-bold tracking-[-0.7px]">Weyver 織雲 設計系統</h1>
          <p className="mt-3 max-w-[560px] text-[14px] leading-relaxed text-ink-2">
            企業級多產業製造平台的統一視覺語言。所有前端產出以此為單一真實來源 —— 對齊 Dynamics /
            Ramp / Sigma 級企業 SaaS 基準:精準、克制、資料導向、可信賴。
          </p>
          <div className="mt-5 rounded-md border-l-[3px] border-brand bg-brand-tint px-4 py-3.5 text-[13px] leading-relaxed text-teal-900">
            <b>品牌故事</b>　客戶散落的三套 ERP、五份 Excel、十個 Ragic 表單,都是<b>線頭</b>
            ;Weyver(織雲)把它們<b>織成一整朵雲</b> ——
            一個平台,看得見全貌。品牌隱喻存於敘事與命名,不外顯為裝飾。
          </div>
        </div>

        <Section
          id="color"
          title="色彩"
          desc="品牌深海青 #0C5F73 —— 台灣 ERP 競品清一色藍,此色差異化,兼具精密儀器感與雲/水意象。色彩走語意 token,禁硬編 hex。"
        >
          <h3 className="mb-3 text-[13px] font-semibold">品牌 · 深海青階</h3>
          <div className="mb-4 grid grid-cols-5 gap-2.5">
            {tealScale.map((s) => (
              <div key={s.name} className="overflow-hidden rounded-md border border-border bg-card">
                <div className={`h-14 ${s.cls}`} />
                <div className="px-2.5 py-2">
                  <div className="text-[11.5px] font-semibold">{s.name}</div>
                  <div className="mt-px font-mono text-[10.5px] text-ink-3">{s.hex}</div>
                </div>
              </div>
            ))}
          </div>
          <h3 className="mb-3 text-[13px] font-semibold">中性 · Ink</h3>
          <div className="mb-4 grid grid-cols-5 gap-2.5">
            {inkScale.map((s) => (
              <div key={s.name} className="overflow-hidden rounded-md border border-border bg-card">
                <div className={`h-14 ${s.cls}`} />
                <div className="px-2.5 py-2">
                  <div className="text-[11.5px] font-semibold">{s.name}</div>
                  <div className="mt-px font-mono text-[10.5px] text-ink-3">{s.hex}</div>
                </div>
              </div>
            ))}
          </div>
          <h3 className="mb-3 text-[13px] font-semibold">語意 · 狀態</h3>
          <div className="grid grid-cols-5 gap-2.5">
            {semantic.map((s) => (
              <div key={s.name} className="rounded-md border border-border bg-card p-3">
                <div className={`mb-2.5 size-6 rounded-sm ${s.cls}`} />
                <div className="text-[12px] font-semibold">{s.name}</div>
                <div className="mt-0.5 text-[10.5px] text-ink-3">{s.use}</div>
                <div className="mt-1.5 font-mono text-[10px] text-ink-4">{s.hex}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="type"
          title="字型"
          desc="IBM Plex 超家族 —— IBM 委託設計之企業識別字體。Latin + 繁中 + Mono 同一套設計語言,工程/精密性格呼應製造業。數字一律 tabular-nums。"
        >
          <div className="mb-5 grid grid-cols-3 gap-3">
            {[
              { big: "Weyver", nm: "IBM Plex Sans", role: "UI · Label · 標題 · 內文", mono: false },
              { big: "織雲平台", nm: "IBM Plex Sans TC", role: "繁體中文(同源)", mono: false },
              { big: "4.82M", nm: "IBM Plex Mono", role: "數字 · 金額 · 批號 · 代碼", mono: true },
            ].map((f) => (
              <div key={f.nm} className="rounded-md border border-border bg-card px-4 py-4">
                <div
                  className={`mb-2.5 text-[28px] leading-none ${f.mono ? "font-mono tabular-nums" : ""}`}
                >
                  {f.big}
                </div>
                <div className="text-[12.5px] font-semibold">{f.nm}</div>
                <div className="mt-0.5 text-[11px] text-ink-3">{f.role}</div>
              </div>
            ))}
          </div>
          <Panel>
            <div className="flex flex-col divide-y divide-border-3">
              {typeScale.map((t) => (
                <div key={t.spec} className="flex items-baseline gap-5 py-3">
                  <span className="w-[110px] shrink-0 font-mono text-[11px] text-ink-3">
                    {t.spec}
                  </span>
                  <span className={t.cls}>{t.label}</span>
                </div>
              ))}
            </div>
          </Panel>
        </Section>

        <Section
          id="tokens"
          title="間距 · 圓角 · 陰影"
          desc="4/8px 間距節奏。圓角克制(6–10px,企業級偏緊)。深度靠細邊框 + 極輕陰影,非軟陰影。"
        >
          <div className="grid grid-cols-2 gap-3">
            <Panel>
              <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-ink-4">
                圓角 Radius
              </div>
              <div className="flex items-end gap-5">
                {[
                  ["rounded-sm", "6px"],
                  ["rounded-md", "8px"],
                  ["rounded-lg", "10px"],
                ].map(([cls, val]) => (
                  <div key={cls} className="text-center">
                    <div
                      className={`mb-2 h-10 w-14 border border-brand-tint-2 bg-brand-tint ${cls}`}
                    />
                    <div className="font-mono text-[10px] text-ink-3">{val}</div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-ink-4">
                陰影 Elevation
              </div>
              <div className="flex items-end gap-6">
                {[
                  ["shadow-sm", "rest"],
                  ["shadow-md", "hover"],
                ].map(([cls, val]) => (
                  <div key={cls} className="text-center">
                    <div className={`mb-2 h-10 w-14 rounded-md bg-card ${cls}`} />
                    <div className="font-mono text-[10px] text-ink-3">{val}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
          <Panel>
            <div className="mb-3 mt-3 text-[11px] font-medium uppercase tracking-wide text-ink-4">
              間距 Spacing(4 / 8 節奏)
            </div>
            <div className="flex items-end gap-4">
              {[4, 8, 12, 16, 24, 32, 48].map((n) => (
                <div key={n} className="text-center">
                  <div className="mx-auto mb-1.5 bg-brand" style={{ width: n, height: 32 }} />
                  <span className="font-mono text-[10px] text-ink-3">{n}</span>
                </div>
              ))}
            </div>
          </Panel>
        </Section>

        <Section
          id="buttons"
          title="按鈕"
          desc="每個畫面只有一個主行動(Primary)。其餘 Secondary / Ghost 視覺次要。破壞性用 Danger 且與主行動分隔。"
        >
          <Panel>
            <div className="flex flex-wrap items-center gap-3">
              <Button>
                <Plus className="size-3" strokeWidth={2} />
                建立記錄
              </Button>
              <Button variant="secondary">篩選</Button>
              <Button variant="ghost">取消</Button>
              <Button variant="danger">刪除</Button>
              <Button size="sm">小按鈕</Button>
            </div>
          </Panel>
        </Section>

        <Section
          id="badges"
          title="狀態標籤"
          desc="狀態一律 dot + 文字 雙重表達,不只靠顏色(WCAG 1.4.1)。pill 形、淡底同色深字。"
        >
          <Panel>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="success">已核准</Badge>
              <Badge variant="warning">待審核</Badge>
              <Badge variant="danger">異常</Badge>
              <Badge variant="info">已收貨</Badge>
              <Badge variant="brand">進行中</Badge>
              <Badge variant="neutral">草稿</Badge>
            </div>
          </Panel>
        </Section>

        <Section
          id="controls"
          title="輸入 · 控制"
          desc="Focus 用深海青 ring(3px tint)。分段控制用於時間 / 檢視切換。"
        >
          <Panel>
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-ink-4">
              輸入框
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Input className="w-60" placeholder="搜尋單據…" icon={<Search strokeWidth={1.4} />} />
            </div>
            <div className="mb-3 mt-5 text-[11px] font-medium uppercase tracking-wide text-ink-4">
              分段控制
            </div>
            <Segmented
              ariaLabel="時段"
              value={period}
              onValueChange={setPeriod}
              options={[
                { label: "今日", value: "today" },
                { label: "本週", value: "week" },
                { label: "本月", value: "month" },
              ]}
            />
          </Panel>
        </Section>

        <Section
          id="data"
          title="資料元件"
          desc="KPI 卡、模組卡、資料表 —— 平台的核心構件。細邊框、mono 數字、hover 抬升、hairline 列分隔(非斑馬紋)。"
        >
          <h3 className="mb-3 text-[13px] font-semibold">KPI 卡</h3>
          <div className="mb-6 flex flex-wrap gap-3">
            <Kpi
              label="本月銷售"
              value="4.82"
              unit="M"
              trend={{ direction: "up", label: "12.3%" }}
            />
            <Kpi label="整體 OEE" value="87" unit="%" note={{ tone: "muted", label: "3 線運行" }} />
            <Kpi label="待我處理" value="8" note={{ tone: "danger", label: "2 件今日到期" }} />
          </div>
          <h3 className="mb-3 text-[13px] font-semibold">模組卡</h3>
          <div className="mb-6 flex flex-wrap gap-3">
            <ModuleCard
              icon={<FileText strokeWidth={1.5} />}
              name="表單引擎"
              meta="247 張表單 · 1.2 萬筆"
            />
            <ModuleCard
              icon={<Boxes strokeWidth={1.5} />}
              name="MES 現場"
              meta="3 線運行"
              value="87%"
            />
          </div>
          <h3 className="mb-3 text-[13px] font-semibold">資料表</h3>
          <DataTable columns={poColumns} data={poRows} getRowKey={(row) => row.no} />
        </Section>

        <Section
          id="dodont"
          title="Do & Don't"
          desc="從 6 版迭代中得到的鐵則。左為企業級標準,右為要避開的消費級 / 後台陷阱。"
        >
          <div className="grid grid-cols-2 gap-3.5">
            <div className="rounded-md border border-[#C6E9D4] bg-success-tint p-5">
              <h4 className="mb-3 text-[13px] font-semibold text-success-dark">Do — 企業級</h4>
              <ul className="flex flex-col gap-2 text-[12.5px] leading-snug text-ink-2">
                {[
                  "頂欄 + 左導航 + 內容的專業 chrome",
                  "資料更新時間戳、同步狀態、篩選信任訊號",
                  "細邊框 + 極輕陰影建立深度",
                  "中性灰白為主,深海青精準點綴",
                  "KPI / 圖表 / 資料表資料導向,數字 tabular-nums",
                  "狀態 = 顏色 + dot + 文字(WCAG AA)",
                  "outline icon,一致筆畫,無 emoji",
                ].map((t) => (
                  <li
                    key={t}
                    className="relative pl-5 before:absolute before:left-0 before:font-bold before:text-success-dark before:content-['✓']"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-[#F3D2CF] bg-danger-tint p-5">
              <h4 className="mb-3 text-[13px] font-semibold text-danger-dark">Don&apos;t — 避開</h4>
              <ul className="flex flex-col gap-2 text-[12.5px] leading-snug text-ink-2">
                {[
                  "in-app 漸層 hero banner(行銷頁手法)",
                  "織雲等品牌隱喻外顯為畫面裝飾",
                  "暖色漸層卡、彩色 icon 塊(消費風)",
                  "大圓角 + 軟陰影堆疊(顯得廉價)",
                  "整片灰色資料表無層次(generic 後台)",
                  "斑馬紋列(ERP legacy)",
                  "切換工作區 UI(單一租戶無此情境)",
                ].map((t) => (
                  <li
                    key={t}
                    className="relative pl-5 before:absolute before:left-0 before:font-bold before:text-danger-dark before:content-['✕']"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
