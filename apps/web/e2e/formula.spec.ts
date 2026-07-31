import { expect, test } from "@playwright/test"

/* P0-3 公式欄:填單即時預覽(client 端與後端同一引擎)→ 存 → 資料檢視顯示計算值。

   🔴 **表由 API 建立,UI 只走「真正要測的那一段」。**
   Playwright 官方 api-testing 逐字:「Prepare server side state before visiting the
   web application in a test.」建表流程本身由 builder.spec 覆蓋一次即可
   (Cypress:「Fully test the login flow -- but only once!」)。

   本檔原本用 UI 建表,設計器改版後就斷在**建表**這個前置步驟 —— 而它要測的
   公式預覽根本沒被執行到(#126)。前置走 API 之後,設計器怎麼改都不影響這條。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }
const uniq = () => Date.now().toString().slice(-6)

test("公式欄:填單即時預覽 → 存 → 資料檢視顯示後端計算值", async ({ page, request }) => {
  const formName = `E2E公式_${uniq()}`
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: formName,
      fields: [
        { name: "單價", type: "money" },
        { name: "數量", type: "number" },
        { name: "小計", type: "formula", options: { expression: "{單價} * {數量}" } },
      ],
    },
  })
  expect(res.status()).toBe(201)
  const formId = (await res.json()).id as number

  await page.goto(`/app/builder?form=${String(formId)}`)
  await expect(page.getByRole("heading", { name: formName })).toBeVisible({ timeout: 30_000 })

  // 1) 填單:輸入即算(client 端 computeFormulaPreview,與後端同引擎)
  await page.getByRole("tab", { name: "填單" }).click()
  const inputs = page.locator("section input")
  await inputs.nth(0).fill("12.5") // 單價
  await inputs.nth(1).fill("4") // 數量
  await expect(page.locator("section").first()).toContainText("50") // 小計即時預覽

  // 2) 存 → 後端讀時算為權威
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText(/已儲存/)).toBeVisible()

  // 3) 資料檢視:落庫記錄之公式欄由後端注入計算值
  await page.getByRole("tab", { name: "資料" }).click()
  await expect(page.getByRole("row").filter({ hasText: "50" }).first()).toBeVisible()
})
