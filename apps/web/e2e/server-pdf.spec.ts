import { expect, test } from "@playwright/test"

/* 🔴 R1·後續-2b|伺服器端 PDF(`docs/modules/R1/server-pdf.md`)。

   現況只有 `window.print()` —— 人站在電腦前可以印,但**產不出一個檔案**。
   這條釘的是「按一個鈕,拿到一份真的 PDF」。

   ⚠️ 這一條會真的開 Chromium 渲染,故較慢;它是本模組唯一的端到端證據
   (整合測試把渲染器換成替身,驗的是票與權限)。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
const uniq = (): string => String(Date.now()).slice(-6)

test("🔴 記錄頁按「下載 PDF」→ 拿到一份真的 PDF 檔", async ({ page, request }) => {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E單據PDF_${uniq()}`,
      fields: [
        { name: "品名", type: "text" },
        { name: "金額", type: "money" },
      ],
    },
  })
  const form = (await res.json()) as { id: number; name: string }
  const created = await request.post(`/api/engine/forms/${String(form.id)}/records`, {
    headers: DEV,
    data: { values: { 品名: "醬油 5L", 金額: "3600" } },
  })
  const row = (await created.json()) as { id: number }

  await page.goto(`/app/forms/${String(form.id)}?record=${String(row.id)}&mode=record`)
  const button = page.getByRole("button", { name: /下載 PDF/ })
  await expect(button).toBeVisible({ timeout: 30_000 })

  /* 產檔是非同步的:送出 → 輪詢 → 自動下載。等的是**檔案**不是動畫。 */
  const download = page.waitForEvent("download", { timeout: 120_000 })
  await button.click()
  const file = await download

  expect(file.suggestedFilename()).toMatch(/\.pdf$/)
  const path = await file.path()
  expect(path).not.toBeNull()

  /* 🔴 斷言到**位元組**:檔名對而內容是一頁錯誤訊息,這條測試就白寫了。
     `%PDF` 是 PDF 的魔術位元組。 */
  const { readFileSync } = await import("node:fs")
  const head = readFileSync(path as string).subarray(0, 5).toString("latin1")
  expect(head).toBe("%PDF-")
})
