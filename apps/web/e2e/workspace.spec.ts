import { expect, test } from "@playwright/test"
import { openPalette } from "./hydration"

/* R1·UP-1 workspace-ia UI 固化:app-shell(status bar)+ 分類目錄首頁 + ⌘K 導航 + 記錄頁動作列。
   對 dev api + 真 PG;dev DB 有狀態(採購單 id 1 有記錄),沿用 builder.spec 之依賴假設。 */

test("工作區:分類目錄 + status bar + ⌘K 導航 + 記錄頁動作列", async ({ page }) => {
  await page.goto("/app")

  // 1) app-shell status bar「已連線」(= 至少一 query 成功 → 亦證 hydration 完成)
  await expect(page.getByText("已連線")).toBeVisible({ timeout: 30_000 })

  // 2) 分類目錄:dev DB 必有表單 → 至少「未分類」區塊
  await expect(page.getByRole("heading", { name: "未分類" })).toBeVisible()

  // 3) ⌘K 導航:開啟 → 搜尋 → Enter 進 Object Page
  /* 快捷鍵的 handler 要 hydrate 之後才存在 —— 用共用 helper 按到開為止 */
  await openPalette(page, "採購")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/app\/forms\/\d+/)

  // 4) 記錄頁動作列(採購單 id 1 有記錄;views-list 後列表為進表預設 → 明指 mode=record)
  await page.goto("/app/forms/1?mode=record")
  await expect(page.getByRole("button", { name: "複製" })).toBeVisible()
  await expect(page.getByRole("button", { name: "刪除" })).toBeVisible()
  await expect(page.getByRole("button", { name: "列印" })).toBeVisible()

  // 5) 複製這筆 → 出現回饋訊息(成功「已複製」或後端驗證訊息;證明動作已接通並回饋)
  await page.getByRole("button", { name: "複製" }).click()
  await expect(page.getByText(/已複製|required|必填|不可/)).toBeVisible()
})
