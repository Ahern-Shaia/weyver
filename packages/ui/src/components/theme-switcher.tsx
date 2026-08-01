"use client"

import { useEffect, useState } from "react"
import type { ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2.1 §2.2|三配色主題:[data-theme] 語意 token 切換。

   🔴 **色塊不再存 hex**。原本這裡寫死 `#1E4E79 / #0C5F73 / #313131`,
   而 tokens.css 早已改成 `#22568a / #0c5f73 / #333739` ——
   於是**你點的色塊顏色,和實際切出來的主題不是同一個顏色**。
   沒有任何檢查會發現這件事(docs/28 §1.4:我方禁 raw hex 只有文件規定)。

   改法:色塊自己掛 `data-theme`,背景吃 `var(--color-primary)` ——
   它就是那個主題的真實主色,不可能對不上。 */
export const THEMES = [
  { id: "navy", label: "深藍" },
  { id: "teal", label: "深海青" },
  { id: "graphite", label: "石墨" },
] as const

export type ThemeId = (typeof THEMES)[number]["id"]

export function applyTheme(theme: ThemeId): void {
  if (theme === "navy") document.documentElement.removeAttribute("data-theme")
  else document.documentElement.setAttribute("data-theme", theme)
}

export function ThemeSwitcher({ className }: { readonly className?: string }): ReactElement {
  const [theme, setTheme] = useState<ThemeId>("navy")

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <div className={cn("flex items-center gap-1", className)} role="radiogroup" aria-label="配色">
      <span className="mr-0.5 text-[12px] text-ink-3">配色</span>
      {THEMES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={theme === item.id}
          title={item.label}
          onClick={() => setTheme(item.id)}
          /* navy 是預設主題(:root),無 data-theme 屬性 */
          {...(item.id === "navy" ? {} : { "data-theme": item.id })}
          className={cn(
            "size-4 rounded-xs border border-line bg-primary",
            theme === item.id && "outline-2 outline-offset-1 outline-primary",
          )}
        />
      ))}
    </div>
  )
}
