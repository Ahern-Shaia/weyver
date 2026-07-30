"use client"

import { ChevronRight } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { SETTINGS_NAV } from "../_components/settings-nav"

/* R1·UX-1 M2|設定中心(docs/04 v2.6 之 S22)。
   左側導覽由 10 個純圖示收斂為 ≤7,設定六項改由此頁承接。 */
export default function SettingsHubPage(): ReactNode {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[840px] px-6 py-7">
        <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">設定</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          租戶層級的管理項目。<span className="text-ink-2">⌘K</span> 可直接跳至任一項。
        </p>

        <div className="mt-5 overflow-hidden rounded-md border border-line bg-card">
          {SETTINGS_NAV.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 transition-colors duration-75 hover:bg-primary-t ${
                i === 0 ? "" : "border-t border-line-2"
              }`}
            >
              <item.icon size={17} strokeWidth={1.9} className="shrink-0 text-ink-3" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{item.label}</span>
                <span className="block text-[12px] text-ink-3">{item.desc}</span>
              </span>
              <ChevronRight size={15} className="ml-auto shrink-0 text-ink-3" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
