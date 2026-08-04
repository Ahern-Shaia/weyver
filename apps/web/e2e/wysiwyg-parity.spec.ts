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
    /* ⚠️ 不用 `firstElementChild` —— 標籤格外面可能包著一層 `display: contents`
       的 `<label>`(R1·A11Y 的無障礙名稱)。那層不佔版面但**是一個 DOM 節點**,
       用直接子節點取會突然量到 0 個欄位格,而錯誤訊息指向「選取器可能失效」。 */
    const cards = Array.from(document.querySelectorAll('div[role="button"]')).filter(
      (e) => e.querySelector(".bg-label") !== null,
    )
    return cards.slice(0, 4).map((e) => ({
      w: Math.round(e.getBoundingClientRect().width),
      labelW: Math.round(e.querySelector(".bg-label")?.getBoundingClientRect().width ?? 0),
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
        /* 同上:`display: contents` 的 `<label>` 本身沒有版面盒,量它會得到 0 */
        labelW: Math.round(c.querySelector(".bg-label")?.getBoundingClientRect().width ?? 0),
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

/* 🔴 audit-D §2.5|**靜態敘述要在填單畫面看得到**。

   `layout.statics[]` 出貨兩個月以來只有設計器畫布讀得到 —— 設計者放了說明文字,
   填單的人看不到,而那正是 `form-designer-2d` §1.1 目標 2 的整個用意。
   §0.5 把它「移交 form-designer-wysiwyg」,而該檔的範圍表與里程碑**都沒有接收**
   —— 移交無接收方,於是它就停在那裡。

   同時釘住 `designOnly`:那是給設計者自己看的註記,**不得**畫到填單畫面。 */
test("🔴 靜態敘述在填單畫面看得到,而 designOnly 的不畫", async ({ page, request }) => {
  const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E靜態元素_${String(Date.now()).slice(-6)}`,
      fields: [{ name: "品名", type: "text" }],
    },
  })
  const form = (await res.json()) as { id: number; fields: { id: number }[] }
  await request.patch(`/api/engine/forms/${String(form.id)}/layout`, {
    headers: DEV,
    data: {
      grid: { cols: 12 },
      fields: { [String(form.fields[0]?.id ?? 0)]: { row: 1, col: 0, colSpan: 6 } },
      statics: [
        { id: "st1", kind: "text", row: 0, col: 0, colSpan: 6, text: "本表僅供內部使用" },
        { id: "st2", kind: "text", row: 2, col: 0, colSpan: 6, text: "設計註記", designOnly: true },
      ],
      sections: [],
    },
  })

  await page.goto(`/app/builder?form=${String(form.id)}&mode=fill`)
  await page.getByRole("tab", { name: "填單" }).click()
  const fill = page.locator("section").filter({ hasText: "填寫" }).last()
  await expect(fill.getByText("本表僅供內部使用")).toBeVisible({ timeout: 30_000 })
  await expect(fill.getByText("設計註記")).toHaveCount(0)
})
