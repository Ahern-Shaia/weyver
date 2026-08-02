import { expect, test } from "@playwright/test"

/* 🔴 docs/14 §2.7 層級配置的**執法**。

   ## 為什麼這支測試存在

   字階規則從 2026-07-31 就寫在 §2.5,但同型失誤已發生**五次**:
   16 種字級 → 色碼硬編 → CSS 的 `font-size` 躺過 CI → 本次 mockup。
   共同點永遠是「規則寫了、沒有檢查」。

   而本次多一個共同點:**`docs/mockups/*.html` 從來沒有任何檢查**。
   prod 有字階 CI,mockup 沒有 —— 於是 mockup 成了規則的黑洞,
   **而 mockup 正是 review 實際看的東西**。

   ⚠️ 這支測不看截圖、不看主觀感受,只量三件事:字級 / 字重比例 / 主標唯一。

   🔴 它上線第一次執行就推翻了作者的初判:起草規格時寫的是「v5 的 600 太少、眼睛沒有落點」,
   實測 **600 佔 12.7%(上限的 2.4 倍)** —— 病灶是**錨點太多**。
   「感覺得出來但說不準」的東西必須量,這正是這支測存在的理由。
   「像公司內部後台」的成因量測後是**缺層級**(只有小字、一種字重、一種間距),
   不是缺裝飾 —— 所以檢查的也是層級,不是美感。 */

const MOCKUP =
  "file:///Users/ahern/Documents/work_work/weyver/docs/mockups/form-designer-wysiwyg.html"

/* docs/14 §2.5 六階;地板 12px,禁 8–11.5px */
const SCALE = new Set([12, 13, 14, 16, 20, 24])

test.describe("docs/14 §2.7 層級配置", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(MOCKUP)
    await page.waitForTimeout(600)
  })

  test("🔴 字級只用六階,地板 12px", async ({ page }) => {
    const bad = await page.evaluate(() => {
      const out: Record<string, number> = {}
      for (const el of Array.from(document.querySelectorAll("*"))) {
        if (el.children.length > 0 || !el.textContent?.trim()) continue
        const px = Number.parseFloat(getComputedStyle(el).fontSize)
        if (![12, 13, 14, 16, 20, 24].includes(Math.round(px)))
          out[`${String(Math.round(px))}px`] = (out[`${String(Math.round(px))}px`] ?? 0) + 1
      }
      return out
    })
    expect(
      bad,
      `字級離開 §2.5 六階 {${[...SCALE].join(",")}}。地板 12px、禁 8–11.5px —— 小字是「內部後台感」的第一成因`,
    ).toEqual({})
  })

  test("🔴 字重要有錨點:600 ≤5% 且 >0,500 ≤20%", async ({ page }) => {
    const w = await page.evaluate(() => {
      const c: Record<string, number> = {}
      let total = 0
      for (const el of Array.from(document.querySelectorAll(".app *"))) {
        if (el.children.length > 0 || !el.textContent?.trim()) continue
        const fw = getComputedStyle(el).fontWeight
        c[fw] = (c[fw] ?? 0) + 1
        total++
      }
      return { c, total }
    })
    const pct = (k: string) => ((w.c[k] ?? 0) / Math.max(1, w.total)) * 100
    /* 600 = 0 代表眼睛沒有落點;600 過多代表「什麼都重要 = 什麼都不重要」 */
    expect(pct("600"), "沒有任何 600 字重 —— 眼睛沒有落點").toBeGreaterThan(0)
    expect(pct("600"), `600 佔 ${pct("600").toFixed(1)}%,超過 5% = 什麼都重要`).toBeLessThanOrEqual(
      5,
    )
    expect(pct("500"), `500 佔 ${pct("500").toFixed(1)}%,超過 20%`).toBeLessThanOrEqual(20)
  })

  /* 🔴 起因:review 問「圖中的 168px 的線是什麼?」——
     量測發現線在 x=434 而 B 欄右緣在 562,`left:410px` 是硬寫的、沒量過。
     自查後同型錯誤還有三個:工具選單偏離觸發鈕 169px、型別 popover 蓋住它正在編輯的那一格、
     右鍵選單沒有錨點。改為由錨點推導後,這條測防止它再退回硬寫。 */
  test("🔴 浮層必須錨定在觸發點,不得硬寫座標", async ({ page }) => {
    const pairs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-anchor]")).map((el) => {
        const a =
          document.getElementById((el as HTMLElement).dataset.anchor ?? "") ??
          document.querySelector(`.${(el as HTMLElement).dataset.anchor ?? ""}`)
        const e = el.getBoundingClientRect()
        return {
          anchor: (el as HTMLElement).dataset.anchor ?? "",
          place: (el as HTMLElement).dataset.place ?? "",
          found: a !== null,
          dx: a === null ? 999 : Math.round(e.left - a.getBoundingClientRect().left),
          gap: a === null ? 999 : Math.round(e.top - a.getBoundingClientRect().bottom),
          dyRight: a === null ? 999 : Math.round(e.top - a.getBoundingClientRect().top),
        }
      }),
    )
    expect(pairs.length, "找不到任何 data-anchor 浮層").toBeGreaterThan(0)
    for (const p of pairs) {
      expect(p.found, `錨點 ${p.anchor} 不存在 —— 浮層會退回硬寫位置`).toBe(true)
      if (p.place === "below") {
        expect(
          Math.abs(p.dx),
          `${p.anchor}:左緣未對齊觸發點(差 ${String(p.dx)}px)`,
        ).toBeLessThanOrEqual(2)
        expect(
          p.gap,
          `${p.anchor}:與觸發點的垂直間距 ${String(p.gap)}px,應為 4`,
        ).toBeLessThanOrEqual(8)
      } else {
        expect(
          Math.abs(p.dyRight),
          `${p.anchor}:頂緣未對齊觸發點(差 ${String(p.dyRight)}px)`,
        ).toBeLessThanOrEqual(2)
      }
    }
  })

  test("🔴 一個 surface 只有一個主標(20 或 24)", async ({ page }) => {
    const perApp = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".app")).map(
        (app) =>
          Array.from(app.querySelectorAll("*")).filter((el) => {
            if (el.children.length > 0 || !el.textContent?.trim()) return false
            const px = Math.round(Number.parseFloat(getComputedStyle(el).fontSize))
            return px >= 20
          }).length,
      ),
    )
    for (const [i, n] of perApp.entries())
      expect(
        n,
        `第 ${String(i + 1)} 屏有 ${String(n)} 個 ≥20px 的標題 —— 主標必須唯一`,
      ).toBeLessThanOrEqual(1)
  })
})
