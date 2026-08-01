import { expect, test } from "@playwright/test"

/* R1·UP-3 form-designer-2d UI 固化:2D 畫布 + 欄位設定面板 + 設計草稿/undo + 儲存版面(PUT layout)
   + 靜態元素 + 拖曳重定位。對 dev api + 真 PG;用採購單(form 1,dev DB 有欄位)。 */

test("2D 設計器:畫布 + 欄位設定 + 草稿 undo + 儲存版面", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "文字", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeDisabled()

  // 點欄位卡(供應商=單行文字)→ 設定面板
  await page.locator('div[role="button"]:has-text("供應商")').first().click()
  await expect(page.getByRole("textbox", { name: "提示文字(placeholder)" })).toBeVisible()

  // 設 placeholder → dirty(儲存版面 + 復原 啟用)
  await page.getByRole("textbox", { name: "提示文字(placeholder)" }).fill("暫存值")
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeEnabled()
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeEnabled()

  // 復原 → 回乾淨(儲存版面 disabled)
  await page.getByRole("button", { name: "復原", exact: true }).click()
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeDisabled()

  // 重設 placeholder(唯一值,避免與既存 layout 同值 → 非 dirty)+ 儲存 → PUT layout 成功
  await page.locator('div[role="button"]:has-text("供應商")').first().click()
  await page
    .getByRole("textbox", { name: "提示文字(placeholder)" })
    .fill(`供應商_${Date.now().toString().slice(-5)}`)
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeEnabled()
  await page.getByRole("button", { name: "儲存版面" }).click()
  await expect(page.getByText("版面已儲存")).toBeVisible()
})

test("2D 設計器:加靜態文字元素", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "文字", exact: true }).click()
  // 靜態文字元素設定面板 + dirty
  await expect(page.getByText("文字元素")).toBeVisible()
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeEnabled()
})

test("2D 設計器:拖曳欄位重定位 → dirty", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })
  const grip = page.getByRole("button", { name: "拖曳 供應商", exact: true })
  const box = await grip.boundingBox()
  if (box === null) throw new Error("no grip bounding box")
  // dnd-kit 需連續 pointermove(單跳 dragTo → delta 0);分步 mouse 移動
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 220, box.y + 8, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeEnabled()
})
