import { expect, test } from "@playwright/test"

/* 🔴 主色階由 `--base-brand` 推導之**瀏覽器層守衛**(docs/14 §0.4 / docs/28 §1.2)。

   ## 為什麼這一條非得在瀏覽器裡測

   `contrast.test.ts` 讀的是 `tokens.css` 的**文字**,只看得出「有沒有寫對」;
   看不出 **CSS 自訂屬性的代換時機**。而這次改推導時,真正壞掉的就是時機:

   `--color-primary: var(--base-brand)` 寫在 `@theme`(= `:root`),於 `:root` 就代換完畢,
   子元素只繼承那個**算好的顏色**。所以在子元素上改 `--base-brand` 不會讓它重算 ——
   主題色塊(每顆掛一個 `data-theme` 以預覽該主題)量出來**三顆同色**,
   而當時全部單元測試是綠的。

   修法是在 `[data-theme]` 上重新宣告一次推導;本測試把它釘住。

   ## 斷言兩件事

   1. **元素層**:三顆色塊三種色,且**不隨當前主題改變** —— 預覽就該是預覽。
   2. **文件層**:切主題後主色確實跟著換,且深色階 / 淡底是由 base 推導而來
      (推導壞掉會退化成三個主題共用同一組深淺)。 */

const SWATCH = '[role="radiogroup"][aria-label="配色"] button'

const swatchColors = async (page: import("@playwright/test").Page): Promise<string[]> =>
  page.$$eval(SWATCH, (els) => els.map((e) => getComputedStyle(e).backgroundColor))

test("主題色塊:三色互異,且不隨當前主題漂移", async ({ page }) => {
  await page.goto("/design-system")
  await page.waitForSelector(SWATCH)

  const atNavy = await swatchColors(page)
  expect(atNavy).toHaveLength(3)
  expect(new Set(atNavy).size, `三顆色塊應為三種顏色,實得 ${atNavy.join(" / ")}`).toBe(3)

  /* 切到另外兩個主題後,色塊**必須完全不變** —— 它們是各主題的預覽,不是當前主題的回音。 */
  for (const label of ["深海青", "石墨"]) {
    await page.click(`${SWATCH}[title="${label}"]`)
    await expect.poll(async () => (await swatchColors(page)).join(",")).toBe(atNavy.join(","))
  }
})

test("切換主題:主色改變,且深色階與淡底由 base 推導", async ({ page }) => {
  await page.goto("/design-system")
  await page.waitForSelector(SWATCH)

  const read = async (): Promise<{ p: string; d: string; t: string }> =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      const px = (n: string): string => {
        const el = document.createElement("div")
        el.style.color = cs.getPropertyValue(n).trim()
        document.body.appendChild(el)
        const v = getComputedStyle(el).color
        el.remove()
        return v
      }
      return { p: px("--color-primary"), d: px("--color-primary-d"), t: px("--color-primary-t") }
    })

  const navy = await read()
  await page.click(`${SWATCH}[title="深海青"]`)
  await expect.poll(async () => (await read()).p).not.toBe(navy.p)

  const teal = await read()
  /* 推導若失效(例如有人把 -d / -t 改回手寫並漏改其中一個主題),
     這裡會抓到「主色換了但深淺沒換」。 */
  expect(teal.d, "深色階應隨主色改變").not.toBe(navy.d)
  expect(teal.t, "淡底應隨主色改變").not.toBe(navy.t)
  /* 三個值必須互異 —— 若 color-mix 未被支援或百分比寫成 0,它們會塌成同一個顏色。 */
  expect(new Set([teal.p, teal.d, teal.t]).size).toBe(3)
})
