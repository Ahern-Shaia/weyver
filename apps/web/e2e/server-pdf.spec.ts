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
     `%PDF` 是 PDF 的魔術位元組。

     ⚠️ 2026-08-06:這條斷言**不足以**擋掉「內容是一頁錯誤訊息」——
     Next 的 500 錯誤頁印出來也是一份合法 PDF,魔術位元組一樣對。
     真正的防線改在渲染器(`playwright-renderer` 檢查 HTTP 狀態);
     這裡留著是因為它便宜,但它不是那條防線。 */
  const { readFileSync } = await import("node:fs")
  const head = readFileSync(path as string)
    .subarray(0, 5)
    .toString("latin1")
  expect(head).toBe("%PDF-")
})

/* 🔴 M2 A3|附件合併。單元測試把 `FilesService` 整個 mock 掉了,
   所以「授權鏈 → 物件儲存 → pdf-lib 接頁」這條真的鏈只有這裡走得到。 */
test("🔴 勾「含附件」→ 附件的頁真的接在單據後面", async ({ page, request }) => {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E附件合併_${uniq()}`,
      fields: [
        { name: "品名", type: "text" },
        { name: "附件", type: "attachment" },
      ],
    },
  })
  const form = (await res.json()) as { id: number; fields: { id: number; name: string }[] }
  const fieldId = form.fields.find((f) => f.name === "附件")?.id ?? 0

  /* 上傳一份**乾淨的**兩頁 PDF。
     ⚠️ 不能拿 Chromium 產的 PDF 來當附件:上傳的安全鏈會以
     「PDF 含主動內容(/AA)」擋掉它(2026-08-06 手測踩到)。 */
  const upload = await request.post(`/api/engine/forms/${String(form.id)}/files`, {
    headers: { "x-dev-tenant": "1" },
    multipart: {
      file: { name: "附件.pdf", mimeType: "application/pdf", buffer: twoPagePdf() },
    },
    params: { fieldId },
  })
  expect(upload.status()).toBe(201)
  const file = (await upload.json()) as { key: string; name: string }

  const created = await request.post(`/api/engine/forms/${String(form.id)}/records`, {
    headers: DEV,
    data: { values: { 品名: "醬油 5L", 附件: [{ key: file.key, name: file.name }] } },
  })
  expect(created.status()).toBe(201)
  const row = (await created.json()) as { id: number }

  await page.goto(`/app/forms/${String(form.id)}?record=${String(row.id)}&mode=record`)
  /* 「含附件」**只在這筆真的有附件時出現** —— 看得到它本身就是一條斷言 */
  const withAttachments = page.getByRole("checkbox", { name: /含附件/ })
  await expect(withAttachments).toBeVisible({ timeout: 30_000 })
  await withAttachments.check()

  const download = page.waitForEvent("download", { timeout: 120_000 })
  await page.getByRole("button", { name: /下載 PDF/ }).click()
  const got = await download
  const { readFileSync } = await import("node:fs")
  const bytes = readFileSync((await got.path()) as string)

  /* 單據 1 頁 + 附件 2 頁。只斷言「比 1 頁多」的話,附件只併進去一頁也會過。 */
  expect(countPages(bytes)).toBe(3)
})

/* 頁數用原始位元組數 `/Type /Page` —— 頁物件不在壓縮串流裡,
   數得到,且不必為一條測試把 pdf-lib 裝進 web。 */
function countPages(bytes: Buffer): number {
  return (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

/* 最小的合法兩頁 PDF,手寫。**刻意不含 `/AA` 等主動內容** —— 那會被上傳擋下。 */
function twoPagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
  ]
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${String(i + 1)} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`
  return Buffer.from(body, "latin1")
}
