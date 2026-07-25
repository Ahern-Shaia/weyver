import { expect, test } from "@playwright/test"

/* R1·後續-1 M5 UI 固化:設計器動作/簽核雙頁籤 + 記錄頁自訂按鈕執行(確認 dialog → updateSelf)。
   引擎(狀態機/ZEN 路由/冪等/記錄鎖)由 api integration 14 測固化;此 spec 固化 UI 路徑。
   dev DB 有狀態(採購單 form 1 已於 M3 掛「標記已處理」按鈕)。 */

test("設計器:動作/簽核 雙頁籤", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "動作/簽核" }).click()
  // 自訂按鈕頁:動作型別選單
  await expect(page.getByRole("button", { name: "自訂按鈕" })).toBeVisible()
  await expect(page.getByRole("option", { name: "資料拋轉到其他表單" })).toBeAttached()
  await expect(page.getByRole("button", { name: "新增按鈕" })).toBeVisible()

  // 簽核流程頁:步驟 + 完成後執行
  await page.getByRole("button", { name: "簽核流程" }).click()
  await expect(page.getByPlaceholder("流程名稱")).toBeVisible()
  await expect(page.getByRole("button", { name: "加一關" })).toBeVisible()
  await expect(page.getByRole("button", { name: "建立流程" })).toBeVisible()
})

test("記錄頁:自訂按鈕確認 → 執行 → 回饋", async ({ page }) => {
  page.on("dialog", (d) => void d.accept())
  await page.goto("/app/forms/1?mode=record")
  await expect(page.getByRole("button", { name: "送簽" })).toBeVisible({ timeout: 30_000 })

  const btn = page.getByRole("button", { name: "標記已處理" })
  await expect(btn).toBeVisible()
  await btn.click()
  // 首次 → 已更新;重跑 → 冪等 duplicate;兩者皆為成功回饋
  await expect(page.getByText(/已更新本筆|已執行過/)).toBeVisible()
})
