import { expect, test } from "@playwright/test"

/* R1·UP-4b M4 UI 固化:圖片欄(多張上傳 + 縮圖預覽)與簽名欄(canvas 手寫 → PNG)。
   後端(欄型、影像 MIME 收斂 415、簽名單張 422)由 api integration 6 測固化。
   自建獨立表單以免依賴 dev DB 既有狀態。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "7" }
const uniq = () => Date.now().toString().slice(-6)

/* 1x1 紅點 PNG(magic bytes 合法,後端依內容判型) */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

async function createMediaForm(
  request: import("@playwright/test").APIRequestContext,
): Promise<number> {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E拍照單_${uniq()}`,
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "現場照片", type: "image" },
        { name: "簽收", type: "signature" },
      ],
    },
  })
  expect(res.status()).toBe(201)
  return (await res.json()).id as number
}

/* canvas 上以 Pointer Events 畫一段線;回傳已著色像素數以證明真的畫上去了 */
async function drawSignature(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label*="簽名板"]')
    if (canvas === null) return 0
    const rect = canvas.getBoundingClientRect()
    const at = (x: number, y: number): PointerEventInit => ({
      pointerId: 1,
      bubbles: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerType: "mouse",
      isPrimary: true,
    })
    canvas.setPointerCapture = () => undefined
    canvas.dispatchEvent(new PointerEvent("pointerdown", at(20, 40)))
    for (let i = 1; i <= 12; i++) {
      canvas.dispatchEvent(new PointerEvent("pointermove", at(20 + i * 12, 40 + Math.sin(i) * 20)))
    }
    canvas.dispatchEvent(new PointerEvent("pointerup", at(160, 40)))
    const ctx = canvas.getContext("2d")
    if (ctx === null) return 0
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) painted++
    return painted
  })
}

test("圖片欄:上傳 → 縮圖預覽 → 存檔 → 記錄頁顯示", async ({ page, request }) => {
  const formId = await createMediaForm(request)
  await page.goto(`/app/builder?form=${formId}&tab=fill`)
  await page.getByRole("tab", { name: "填單" }).click()

  await page.getByRole("textbox").first().fill("冷凍雞胸肉")
  await page.setInputFiles('input[type="file"]', {
    name: "現場.png",
    mimeType: "image/png",
    buffer: PNG,
  })
  // 縮圖以 <img> 呈現(值契約同附件,差別在呈現)
  await expect(page.getByRole("img", { name: "現場.png" })).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "儲存", exact: true }).click()
  await expect(page.getByText("已儲存")).toBeVisible({ timeout: 30_000 })

  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByRole("img", { name: "現場.png" })).toBeVisible({ timeout: 30_000 })
})

test("簽名欄:canvas 手寫 → 轉 PNG 上傳 → 記錄頁顯示簽名圖", async ({ page, request }) => {
  const formId = await createMediaForm(request)
  await page.goto(`/app/builder?form=${formId}&tab=fill`)
  await page.getByRole("tab", { name: "填單" }).click()
  await page.getByRole("textbox").first().fill("簽收測試")

  const painted = await drawSignature(page)
  expect(painted).toBeGreaterThan(100)

  await page.getByRole("button", { name: "確認簽名" }).click()
  // 上傳完成後 canvas 換成縮圖 + 「重新簽名」(單張語意)
  await expect(page.getByRole("button", { name: "重新簽名" })).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "儲存", exact: true }).click()
  await expect(page.getByText("已儲存")).toBeVisible({ timeout: 30_000 })

  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByRole("img", { name: /^signature-/ })).toBeVisible({ timeout: 30_000 })
})

test("簽名欄:未簽即確認 → 明示提示,不產生空白檔", async ({ page, request }) => {
  const formId = await createMediaForm(request)
  await page.goto(`/app/builder?form=${formId}&tab=fill`)
  await page.getByRole("tab", { name: "填單" }).click()

  await page.getByRole("button", { name: "確認簽名" }).click()
  await expect(page.getByText("請先簽名")).toBeVisible()
  await expect(page.getByRole("button", { name: "重新簽名" })).toBeHidden()
})
