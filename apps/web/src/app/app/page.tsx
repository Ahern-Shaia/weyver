"use client"

import { Button } from "@weyver/ui/button"
import { RecordRail } from "@weyver/ui/record-rail"
import { Segmented } from "@weyver/ui/segmented"
import { StatusBar, StatusBarDot } from "@weyver/ui/status-bar"
import { RecordNav, Toolbar } from "@weyver/ui/toolbar"
import { useState } from "react"
import { RAIL_ITEMS } from "./_components/po-data"
import { PoDesignerView } from "./_components/po-designer-view"
import { PoFormView } from "./_components/po-form-view"
import { PoGridView } from "./_components/po-grid-view"
import { PoListView } from "./_components/po-list-view"

const VIEWS = [
  { label: "表單", value: "form" },
  { label: "列表", value: "list" },
  { label: "網格", value: "grid" },
  { label: "設計", value: "design" },
] as const

export default function AppDemoPage() {
  const [activeRecord, setActiveRecord] = useState("1")
  const [view, setView] = useState<string>("form")

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
        {view !== "design" ? (
          <RecordRail
            header={
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                採購單
                <span className="ml-auto rounded-xs border border-current px-1 text-[9px] font-semibold text-fx">
                  GL 連動
                </span>
              </div>
            }
            items={RAIL_ITEMS}
            activeId={activeRecord}
            onSelect={(id) => {
              setActiveRecord(id)
              setView("form")
            }}
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
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col bg-surface">
          <Toolbar
            crumb={
              <>
                採購 › <b className="font-medium text-ink-2">採購單</b>
              </>
            }
            right={
              <>
                <Segmented ariaLabel="檢視" value={view} onValueChange={setView} options={VIEWS} />
                {view === "form" ? <RecordNav index={1} total={248} /> : null}
              </>
            }
          >
            {view === "form" ? (
              <>
                <Button variant="primary">核准並過帳</Button>
                <Button>儲存</Button>
                <Button>新增</Button>
                <Button>列印 ▾</Button>
                <Button>表單工具 ▾</Button>
              </>
            ) : null}
            {view === "list" ? <Button>匯出 Excel</Button> : null}
            {view === "grid" ? <Button>匯出 Excel</Button> : null}
          </Toolbar>

          {view === "form" ? <PoFormView /> : null}
          {view === "list" ? (
            <div className="flex-1 overflow-y-auto">
              <PoListView
                selectedId={activeRecord}
                onOpenRecord={(id) => {
                  setActiveRecord(id)
                  setView("form")
                }}
              />
            </div>
          ) : null}
          {view === "grid" ? (
            <div className="flex-1 overflow-y-auto">
              <PoGridView />
            </div>
          ) : null}
          {view === "design" ? <PoDesignerView /> : null}

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
  )
}
