"use client"

import { ChevronRight } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { SETTINGS_NAV, type SettingsScope } from "../_components/settings-nav"

/* R1·UX-1 M2 / A-1 M1|設定中心(docs/04 v2.6 之 S22)。

   🔴 **分成「公司」與「個人」兩區,不是平鋪一張清單。**
   原本副標寫「租戶層級的管理項目」—— 個人設定進來之後那句就不成立了。
   平鋪的話,使用者無從判斷改一個值會不會影響同事;而那正是租戶/個人切分
   (settings-center.md §0.2)整節研究要解決的問題,不該在入口就被抹平。 */

const SECTIONS: readonly { scope: SettingsScope; title: string; hint: string }[] = [
  { scope: "tenant", title: "公司", hint: "影響整個公司的所有人" },
  { scope: "personal", title: "個人", hint: "只影響你自己" },
]

export default function SettingsHubPage(): ReactNode {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[840px] px-6 py-7">
        <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">設定</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          <span className="text-ink-2">⌘K</span> 可直接跳至任一項。
        </p>

        {SECTIONS.map((section) => {
          const items = SETTINGS_NAV.filter((i) => i.scope === section.scope)
          return (
            <section key={section.scope} className="mt-6">
              <h2 className="flex items-baseline gap-2 text-[13px] font-semibold text-ink">
                {section.title}
                <span className="font-normal text-[12px] text-ink-3">{section.hint}</span>
              </h2>
              <div className="mt-2 overflow-hidden rounded-md border border-line bg-card">
                {items.map((item, i) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors duration-fast-01 ease-productive-exit hover:bg-primary-t ${
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
            </section>
          )
        })}
      </div>
    </div>
  )
}
