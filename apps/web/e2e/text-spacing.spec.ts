import { expect, test, type Page } from "@playwright/test"

/* R1·UX-1 M6|**WCAG 1.4.12 Text Spacing(AA)可執行驗收**。

   官方要求:使用者套用以下設定時,**內容或功能不得遺失或被裁切** ——
     line-height ≥ 1.5 倍字級 · 段距 ≥ 2 倍字級 · 字距 ≥ 0.12 倍 · 詞距 ≥ 0.16 倍

   ⚠️ 注意:這**不是**要求我方把行高設成 1.5,而是要求「使用者這樣改時不會壞」。
   典型破法是 `height` 固定 + `overflow:hidden` —— 故本測試注入該組設定後,
   逐一比對元素的 scrollHeight 是否超出 clientHeight(即內容被裁切)。 */

const SPACING_CSS = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-bottom: 2em !important; }
`

interface Clipped {
  readonly tag: string
  readonly text: string
  readonly cls: string
}

/* 找出「內容高度超出容器且被 hidden 裁掉」的元素。
   刻意排除刻意捲動的容器(overflow auto/scroll)—— 那是設計意圖不是裁切。 */
async function findClipped(page: Page): Promise<Clipped[]> {
  return page.evaluate(() => {
    const out: { tag: string; text: string; cls: string }[] = []
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden") continue
      const oy = cs.overflowY
      const ox = cs.overflowX
      if (oy !== "hidden" && ox !== "hidden") continue
      const vClip = oy === "hidden" && el.scrollHeight - el.clientHeight > 2
      const hClip = ox === "hidden" && el.scrollWidth - el.clientWidth > 2
      if (!vClip && !hClip) continue
      /* truncate / line-clamp 是刻意的單行省略,不算 1.4.12 的「內容遺失」
         (文字仍可由 title / 完整值取得),排除以免誤報 */
      if (el.classList.contains("truncate") || cs.textOverflow === "ellipsis") continue
      if (el.className.toString().includes("line-clamp")) continue
      /* 純裝飾元素(aria-hidden 且無文字)不承載內容,1.4.12 的「內容遺失」與其無關 ——
         例:進度條軌道。本專案的 BusyBar 即因此被首版檢查誤報。 */
      if (el.getAttribute("aria-hidden") === "true" && (el.textContent ?? "").trim() === "")
        continue
      out.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? "").trim().slice(0, 40),
        cls: el.className.toString().slice(0, 90),
      })
    }
    return out.slice(0, 12)
  })
}

const SURFACES: readonly { readonly name: string; readonly path: string }[] = [
  { name: "工作區首頁", path: "/app" },
  { name: "設定中心", path: "/app/settings" },
  { name: "表單設計器", path: "/app/builder" },
  { name: "權限設定", path: "/app/settings/permissions" },
  { name: "整合設定", path: "/app/settings/integrations" },
]

for (const s of SURFACES) {
  test(`WCAG 1.4.12 文字間距:${s.name}不因加大行高/字距而裁切`, async ({ page }) => {
    await page.goto(s.path)
    // 等主要內容出現,避免在骨架狀態下量測
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState("networkidle").catch(() => undefined)

    await page.addStyleTag({ content: SPACING_CSS })
    await page.waitForTimeout(150)

    const clipped = await findClipped(page)
    expect(
      clipped,
      `以下元素在套用 WCAG 1.4.12 文字間距後被裁切(應改用 min-height 而非固定 height):\n${JSON.stringify(clipped, null, 2)}`,
    ).toEqual([])
  })
}
