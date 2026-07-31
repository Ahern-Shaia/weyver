"use client"

import { useEffect, useState } from "react"
import type { ReactElement } from "react"
import { cn } from "../lib/utils"

/* docs/14 v2.1 §2.2|三配色主題:[data-theme] 語意 token 切換 */
export const THEMES = [
  { id: "navy", label: "深藍", hex: "#1E4E79" },
  { id: "teal", label: "深海青", hex: "#0C5F73" },
  { id: "graphite", label: "石墨", hex: "#313131" },
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
      <span className="mr-0.5 text-[10px] text-ink-3">配色</span>
      {THEMES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={theme === item.id}
          title={item.label}
          onClick={() => setTheme(item.id)}
          style={{ backgroundColor: item.hex }}
          className={cn(
            "size-4 rounded-xs border border-line",
            theme === item.id && "outline-2 outline-offset-1 outline-primary",
          )}
        />
      ))}
    </div>
  )
}
