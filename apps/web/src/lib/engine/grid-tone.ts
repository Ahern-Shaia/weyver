import type { ChipTone } from "@weyver/ui/status-chip"

/* R1·UP-3b|Glide 網格之 tone → themeOverride。

   Glide 以 JS 物件(非 CSS class)設定每格主題,故此處必須有實際色值。
   **仍是白名單查表**:key 為受控 tone,查無即不覆寫(FMEA G1 —— 使用者輸入
   永遠不會成為色值本身)。數值與 packages/ui tokens.css 同源,異動需同步。 */
const GRID_TONE: Record<ChipTone, { readonly bgCell: string; readonly textDark: string }> = {
  ok: { bgCell: "#eaf4ee", textDark: "#1a7a43" },
  warn: { bgCell: "#f8f1e2", textDark: "#96590a" },
  error: { bgCell: "#f9ecea", textDark: "#b3261e" },
  neutral: { bgCell: "#eef0f2", textDark: "#4a5560" },
  c1: { bgCell: "#eaf1f8", textDark: "#1f5f9e" },
  c2: { bgCell: "#eeeff9", textDark: "#4a4fa8" },
  c3: { bgCell: "#f2edf9", textDark: "#6b46a8" },
  c4: { bgCell: "#f7ecf3", textDark: "#8f3a76" },
  c5: { bgCell: "#e8f4f4", textDark: "#0f6b6b" },
  c6: { bgCell: "#e9f3f7", textDark: "#1a6a86" },
  c7: { bgCell: "#f0f3e4", textDark: "#5e6b1f" },
  c8: { bgCell: "#f7eee8", textDark: "#8a4b2a" },
}

export function gridThemeOverride(
  tone: ChipTone | undefined,
): { bgCell: string; textDark: string } | undefined {
  return tone === undefined ? undefined : GRID_TONE[tone]
}
