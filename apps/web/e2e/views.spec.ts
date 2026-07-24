import { expect, test } from "@playwright/test"

/* R1·UP-2 views-list UI 固化:集合(browse)視圖 + 雙模式 + 快速搜尋 + 篩選面板 + 儲存檢視 + 匯出。
   對 dev api + 真 PG;用採購單(form 1,dev DB 有記錄,含供應商「正大食材」),沿用 builder.spec 依賴假設。 */

test("集合視圖:列表渲染 + 快速搜尋", async ({ page }) => {
  await page.goto("/app/forms/1?mode=list")

  // 控制列:預設檢視選擇器 + 篩選/排序/另存
  await expect(page.getByRole("combobox").first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "篩選" })).toBeVisible()
  await expect(page.getByRole("button", { name: "另存" })).toBeVisible()

  // 快速搜尋「正大」→ 只剩 1 筆(PO-0003 正大食材)
  await page.getByPlaceholder("搜尋此表單…").fill("正大")
  await expect(page.getByText("1 筆")).toBeVisible()
})

test("集合視圖:篩選面板加條件", async ({ page }) => {
  await page.goto("/app/forms/1?mode=list")
  await page.getByRole("button", { name: "篩選" }).click()
  await expect(page.getByText("符合")).toBeVisible()
  await page.getByRole("button", { name: "加條件" }).click()
  // 條件列出現(欄位 + operator + 值 selects/inputs;至少多出欄位 combobox)
  await expect(page.getByRole("combobox").nth(1)).toBeVisible()
})

test("集合視圖:匯出 Excel", async ({ page }) => {
  await page.goto("/app/forms/1?mode=list")
  await expect(page.getByText(/筆/).first()).toBeVisible({ timeout: 30_000 })
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "匯出 Excel" }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/)
})

test("另存個人檢視 → 出現於檢視選擇器", async ({ page }) => {
  const name = `E2E檢視_${Date.now().toString().slice(-6)}`
  page.on("dialog", async (dialog) => {
    // 第一個 = prompt(名稱)→ 接受;第二個 = confirm(是否共通)→ 取消(個人)
    if (dialog.type() === "prompt") await dialog.accept(name)
    else await dialog.dismiss()
  })
  await page.goto("/app/forms/1?mode=list")
  await expect(page.getByRole("button", { name: "另存" })).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "另存" }).click()
  await expect(page.getByText(/已儲存檢視/)).toBeVisible()
  await expect(page.getByRole("option", { name: new RegExp(name) })).toBeAttached()
})

test("雙模式:列表 → 記錄(Object Page)", async ({ page }) => {
  await page.goto("/app/forms/1?mode=list")
  await page.getByRole("tab", { name: "記錄" }).click()
  await expect(page).toHaveURL(/mode=record/)
  await expect(page.getByRole("button", { name: "複製" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("基本資料").first()).toBeVisible()
})
