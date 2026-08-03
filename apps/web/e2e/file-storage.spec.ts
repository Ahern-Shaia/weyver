import { expect, test } from "@playwright/test"
import { actUntil } from "./hydration"

/* F-5 M5 UI 固化:附件欄上傳 → 記錄存檔(pending→bound)→ 記錄頁下載 → 移除。
   引擎側(magic bytes / 跨租戶 / hidden 欄 / 配額 / 綁定)由 api integration 16 測固化。
   自建獨立表單以免依賴 dev DB 既有狀態。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "7" }
const uniq = () => Date.now().toString().slice(-6)

/* 以 magic bytes 合法的最小 PDF 當測試檔(後端依內容判型,非副檔名)*/
const PDF = Buffer.from("%PDF-1.7\nweyver e2e attachment\n")

async function createFormWithAttachment(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ formId: number }> {
  const form = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E附件_${uniq()}`,
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "證明文件", type: "attachment" },
      ],
    },
  })
  expect(form.status()).toBe(201)
  return { formId: (await form.json()).id as number }
}

test("附件:填單上傳 → 存檔 → 記錄頁下載", async ({ page, request }) => {
  const { formId } = await createFormWithAttachment(request)
  await page.goto(`/app/builder?form=${formId}&tab=fill`)
  /* tab 的 onClick 要 hydrate 之後才存在 —— 按到填單面板真的出現為止(見 hydration.ts) */
  await actUntil(
    async () => {
      await page.getByRole("tab", { name: "填單" }).click()
    },
    async () => {
      await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: 3_000 })
    },
  )

  /* 🔴 收斂到填寫區塊 —— 整頁範圍的 `.first()` 會打到左欄的「搜尋表單」框。
     那次改版之後這條就一直紅著,而失敗訊息是「已儲存沒出現」,指不到真因。
     同一個形態 `builder.spec` 已修過一次(見該檔註解)。 */
  const fill_7131187759429270136 = page.locator("section").filter({ hasText: "填寫" }).last()
  await fill_7131187759429270136.getByRole("textbox").first().fill("冷凍雞胸肉")
  await page.setInputFiles('input[type="file"]', {
    name: "驗收單.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  })
  await expect(page.getByRole("button", { name: "驗收單.pdf", exact: true })).toBeVisible({
    timeout: 30_000,
  })

  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText("已儲存")).toBeVisible({ timeout: 30_000 })

  // 兩階段綁定:存檔後檔案應綁上記錄(欄值帶回 key)
  const records = await request.get(`/api/engine/forms/${formId}/records`, { headers: DEV })
  const values = (await records.json()).records[0].values as Record<string, unknown>
  const files = values.證明文件 as { key: string; name: string }[]
  expect(files).toHaveLength(1)
  expect(files[0]?.name).toBe("驗收單.pdf")
  expect(files[0]?.key).toMatch(new RegExp(`^t1/f${formId}/[0-9a-f-]{36}\\.pdf$`))

  // 記錄頁:附件呈現為下載連結(非 [object Object]),點擊觸發下載
  await page.goto(`/app/forms/${formId}?mode=record`)
  const link = page.getByRole("button", { name: "驗收單.pdf", exact: true })
  await expect(link).toBeVisible({ timeout: 30_000 })
  const download = page.waitForEvent("download")
  await link.click()
  expect((await download).suggestedFilename()).toBe("驗收單.pdf")
})

test("附件:移除後欄值不再包含該檔", async ({ page, request }) => {
  const { formId } = await createFormWithAttachment(request)
  await page.goto(`/app/builder?form=${formId}&tab=fill`)
  await page.getByRole("tab", { name: "填單" }).click()

  /* 🔴 收斂到填寫區塊 —— 整頁範圍的 `.first()` 會打到左欄的「搜尋表單」框。
     那次改版之後這條就一直紅著,而失敗訊息是「已儲存沒出現」,指不到真因。
     同一個形態 `builder.spec` 已修過一次(見該檔註解)。 */
  const fill_7157844435574430894 = page.locator("section").filter({ hasText: "填寫" }).last()
  await fill_7157844435574430894.getByRole("textbox").first().fill("移除測試")
  await page.setInputFiles('input[type="file"]', {
    name: "待移除.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  })
  await expect(page.getByRole("button", { name: "待移除.pdf", exact: true })).toBeVisible({
    timeout: 30_000,
  })

  await page.getByRole("button", { name: "移除 待移除.pdf" }).click()
  await expect(page.getByRole("button", { name: "待移除.pdf", exact: true })).toBeHidden()

  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText("已儲存")).toBeVisible({ timeout: 30_000 })

  const records = await request.get(`/api/engine/forms/${formId}/records`, { headers: DEV })
  const values = (await records.json()).records[0].values as Record<string, unknown>
  expect(values.證明文件 ?? null).toBeNull()
})

test("附件:非白名單內容(偽副檔名)於 UI 明示拒絕", async ({ page, request }) => {
  const { formId } = await createFormWithAttachment(request)
  await page.goto(`/app/builder?form=${formId}&tab=fill`)
  await page.getByRole("tab", { name: "填單" }).click()

  // ELF 標頭偽裝成 .pdf → 後端 magic bytes 判定不符 → 415
  await page.setInputFiles('input[type="file"]', {
    name: "malware.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]),
  })
  /* F-7 起 UNSUPPORTED_FILE_TYPE 的訊息改為可行動的指引(含 iPhone HEIC 說明),
     不再是「不支援的檔案類型」一句;此處驗關鍵字而非全句。 */
  await expect(page.getByText("不支援的檔案格式", { exact: false })).toBeVisible({
    timeout: 30_000,
  })
})
