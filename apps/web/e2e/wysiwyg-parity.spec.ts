import { expect, test } from "@playwright/test"

/* 🔴 R1·UP-3c|「設計即所見」的**量測**回歸。

   form-designer-2d 的 D1 裁定是「2D 格線畫布 = 填單畫面本身」,但這條規則寫在文件裡
   兩個月,程式碼裡兩邊各排各的:設計器 12 欄座標、填單 `grid-cols-[136px_1fr]` 平鋪。
   看起來都「有欄位表」,量下去才發現同一個 colSpan 兩邊寬度不同。

   ⚠️ 這正是本專案反覆踩的「文件說有、程式碼沒有」——規則沒有檢查就會漏。
   故這裡量**數字**不看截圖:同一個欄位在兩個頁籤必須是同一個寬度、同一個標籤欄寬。 */

const TOL = 2 // 邊框收合的 ±1px

async function geometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div[role="button"]')).filter(
      (e) => e.firstElementChild?.classList.contains("bg-label") === true,
    )
    return cards.slice(0, 4).map((e) => ({
      w: Math.round(e.getBoundingClientRect().width),
      labelW: Math.round(e.firstElementChild?.getBoundingClientRect().width ?? 0),
    }))
  })
}

test("設計頁籤與填單頁籤的欄位幾何一致", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })
  /* 工具列比畫布先渲染 —— 等到真的有欄位格再量,否則量到空 DOM */
  await expect(page.locator('div[style*="grid-auto-rows"]')).toBeVisible({ timeout: 20_000 })

  const design = await geometry(page)
  expect(design.length, "設計畫布沒有欄位格,選取器可能失效").toBeGreaterThan(0)

  await page
    .locator("button", { hasText: /^填單$/ })
    .first()
    .click()
  await expect(page.getByText("填寫")).toBeVisible({ timeout: 15_000 })

  const fill = await page.evaluate(() => {
    const grid = document.querySelector('section div[style*="grid-template-columns"]')
    return Array.from(grid?.children ?? [])
      .slice(0, 4)
      .map((c) => ({
        w: Math.round(c.getBoundingClientRect().width),
        labelW: Math.round(c.firstElementChild?.getBoundingClientRect().width ?? 0),
      }))
  })
  expect(fill.length, "填單畫面不是格線版面(可能又退回平鋪清單)").toBe(design.length)

  for (const [i, d] of design.entries()) {
    const f = fill[i]
    expect(f, `第 ${String(i)} 欄在填單缺席`).toBeDefined()
    expect(
      Math.abs((f?.w ?? 0) - d.w),
      `第 ${String(i)} 欄寬不一致:設計 ${String(d.w)} / 填單 ${String(f?.w)}`,
    ).toBeLessThanOrEqual(TOL)
    expect(
      Math.abs((f?.labelW ?? 0) - d.labelW),
      `第 ${String(i)} 欄標籤欄寬不一致:設計 ${String(d.labelW)} / 填單 ${String(f?.labelW)}`,
    ).toBeLessThanOrEqual(TOL)
  }
})

test("設計畫布不得回到「卡片＋間距」(gap 必須為 0)", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('div[style*="grid-auto-rows"]')).toBeVisible({ timeout: 20_000 })

  /* gap > 0 會讓欄位變成浮著的卡片 —— 那正是「設計看不出填起來長怎樣」的根因。 */
  const gap = await page.evaluate(() => {
    const grid = document.querySelector('div[style*="grid-auto-rows"]')
    return grid === null ? null : getComputedStyle(grid).gap
  })
  expect(gap, "找不到設計畫布格線容器").not.toBeNull()
  expect(gap).toMatch(/^(0px|normal|0px 0px)$/)
})
