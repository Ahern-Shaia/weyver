import { expect, test } from "@playwright/test"

/* P0-3 公式欄固化(承 MCP 走通):設計器建 formula 欄(運算式)→ 發布(後端自動 defineFormula)
   → 填單即時預覽(client 同引擎)→ 存(後端讀時算)→ 資料檢視顯示計算值。 */

const uniq = () => Date.now().toString().slice(-6)

test("公式欄:建 formula 欄 → 填單即時預覽 → 存 → 資料檢視", async ({ page }) => {
  const formName = `E2E公式_${uniq()}`

  await page.goto("/app/builder")

  // 1) 設計器建表:單價(money)/ 數量(number)/ 小計(formula = 單價 × 數量)
  await page.getByRole("button", { name: "+ 新增" }).click()
  await page.getByRole("textbox", { name: "表單名稱" }).fill(formName)
  await page.getByRole("button", { name: "$ 金額" }).click()
  await page.getByRole("button", { name: "# 數值" }).click()
  await page.getByRole("button", { name: "fx 公式" }).click()

  const rows = page.locator("section li")
  await rows.nth(0).locator("input").first().fill("單價")
  await rows.nth(1).locator("input").first().fill("數量")
  await rows.nth(2).locator("input").first().fill("小計")
  await rows.nth(2).locator('input[placeholder*="公式"]').fill("{單價} * {數量}")

  await page.getByRole("button", { name: "發布表單" }).click()
  await expect(page.getByRole("heading", { name: formName })).toBeVisible()

  // 2) 填單:輸入即算(client 端 computeFormulaPreview,與後端同引擎)
  await page.getByRole("tab", { name: "填單" }).click()
  const inputs = page.locator("section input")
  await inputs.nth(0).fill("12.5") // 單價
  await inputs.nth(1).fill("4") // 數量
  const fillSection = page.locator("section").first()
  await expect(fillSection).toContainText("50") // 小計 = 12.5 × 4 即時預覽

  // 3) 存 → 後端讀時算為權威
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText(/已儲存/)).toBeVisible()

  // 4) 資料檢視:落庫記錄之公式欄由後端注入計算值
  await page.getByRole("tab", { name: "資料" }).click()
  await expect(page.getByRole("row").filter({ hasText: "50" }).first()).toBeVisible()
})
