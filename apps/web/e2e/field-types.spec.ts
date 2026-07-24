import { expect, test } from "@playwright/test"

/* R1·UP-4 field-types-parity M4 UI 固化:進階型別 palette(系統欄/lookup/rollup/link/barcode)+
   設定編輯器。引擎(讀時計算/autoNumber pattern/選項/link)由 api integration 測固化,此 spec 固化設計器 UI。 */

test("進階型別:palette + 設定編輯器渲染", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("進階 · 計算/關聯")).toBeVisible({ timeout: 30_000 })

  // 進階型別 + 條碼在 palette
  await expect(page.getByRole("button", { name: /彙總/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /帶入/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /關聯/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /條碼/ })).toBeVisible()

  // 彙總編輯器:子表選擇 + 聚合函式
  await page.getByRole("button", { name: /彙總/ }).click()
  await expect(page.getByText("加入彙總欄位")).toBeVisible()
  await expect(page.getByRole("option", { name: "加總" })).toBeAttached() // fn 選項
})

test("進階型別:自動編號 pattern 設定(日期段 + 重設)", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("進階 · 計算/關聯")).toBeVisible({ timeout: 30_000 })
  // 自動編號在主 palette(.first():避開 canvas 上型別=自動編號的欄位卡)
  await page.getByRole("button", { name: /自動編號/ }).first().click()
  await expect(page.getByText("加入自動編號欄位")).toBeVisible()
  // pattern 控制:日期段 + 重設範圍
  await expect(page.getByRole("option", { name: "yyyyMM", exact: true })).toBeAttached()
  await expect(page.getByRole("option", { name: "每月重設" })).toBeAttached()
})
