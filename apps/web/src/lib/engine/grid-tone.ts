import type { ChipTone } from "@weyver/ui/status-chip"

/* R1·UP-3b|Glide 網格之 tone → themeOverride。

   Glide 以 JS 物件(非 CSS class)設定每格主題,故此處必須有**實際色值**。

   🔴 但那不代表要把色值抄一份。原本這裡硬編了 12 組 24 個 hex,檔頭寫著
   「數值與 tokens.css 同源,異動需同步」—— 那句話本身就是缺陷的自白:
   靠人記得同步的東西遲早會不同步,而且不同步時**沒有任何機制會發現**。
   (docs/28 §1.4 的同型問題:我方禁 raw hex 只有文件規定、沒有檢查。)

   改為**在執行期讀同一組 CSS 變數**:tokens.css 是唯一真相,換主題或調色時
   網格自動跟著對。讀取結果快取 —— 每格都算一次 `getComputedStyle` 會很慢。

   **仍是白名單查表**:key 為受控 tone,查無即不覆寫
   (FMEA G1 —— 使用者輸入永遠不會成為色值本身)。 */

const TONE_VARS: Record<ChipTone, { readonly bg: string; readonly text: string }> = {
  ok: { bg: "--color-ok-t", text: "--color-ok" },
  warn: { bg: "--color-wn-t", text: "--color-wn" },
  error: { bg: "--color-er-t", text: "--color-er" },
  neutral: { bg: "--color-nt-t", text: "--color-nt" },
  c1: { bg: "--color-c1-t", text: "--color-c1" },
  c2: { bg: "--color-c2-t", text: "--color-c2" },
  c3: { bg: "--color-c3-t", text: "--color-c3" },
  c4: { bg: "--color-c4-t", text: "--color-c4" },
  c5: { bg: "--color-c5-t", text: "--color-c5" },
  c6: { bg: "--color-c6-t", text: "--color-c6" },
  c7: { bg: "--color-c7-t", text: "--color-c7" },
  c8: { bg: "--color-c8-t", text: "--color-c8" },
}

const cache = new Map<ChipTone, { bgCell: string; textDark: string }>()

function readVar(name: string): string {
  if (typeof window === "undefined") return ""
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function gridThemeOverride(
  tone: ChipTone | undefined,
): { bgCell: string; textDark: string } | undefined {
  if (tone === undefined) return undefined
  const hit = cache.get(tone)
  if (hit !== undefined) return hit

  const vars = TONE_VARS[tone]
  const bgCell = readVar(vars.bg)
  const textDark = readVar(vars.text)
  /* 讀不到(SSR / token 未載入)就**不覆寫** —— 給半套顏色比不給更糟:
     背景有色、文字沒有,可能直接讀不到字。 */
  if (bgCell === "" || textDark === "") return undefined

  const resolved = { bgCell, textDark }
  cache.set(tone, resolved)
  return resolved
}

/* 主題切換後既有快取即失效(色值會變)。由 theme-switcher 呼叫。 */
export function resetGridToneCache(): void {
  cache.clear()
}
