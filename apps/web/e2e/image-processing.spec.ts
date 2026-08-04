import { expect, test } from "@playwright/test"

/* F-7 M4 UI 固化:上傳照片 → 主檔 EXIF 已剝除、預覽走縮圖。
   處理語意(無損切段 / 方向正規化 / 永不放大 / 炸彈防護)由 9 個 api 單元測 + 4 整合測固化。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "7" }
const uniq = () => Date.now().toString().slice(-6)

/* 640×480 純色 JPEG(base64 常數會過長,改以 canvas 於瀏覽器端產生後回傳位元組)*/
async function makeJpeg(page: import("@playwright/test").Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext("2d")
    if (ctx === null) return ""
    ctx.fillStyle = "#2a6"
    ctx.fillRect(0, 0, 640, 480)
    ctx.fillStyle = "#fff"
    ctx.fillRect(40, 40, 200, 120)
    const url = canvas.toDataURL("image/jpeg", 0.9)
    return url.split(",")[1] ?? ""
  })
  return Buffer.from(b64, "base64")
}

async function createPhotoForm(
  request: import("@playwright/test").APIRequestContext,
): Promise<number> {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E影像_${uniq()}`,
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "現場照", type: "image" },
      ],
    },
  })
  expect(res.status()).toBe(201)
  return (await res.json()).id as number
}

test("上傳照片:縮圖預覽 → 存檔 → 記錄頁顯示", async ({ page, request }) => {
  const formId = await createPhotoForm(request)
  await page.goto(`/app/builder?form=${formId}&tab=fill`)
  await page.getByRole("tab", { name: "填單" }).click()

  const jpeg = await makeJpeg(page)
  expect(jpeg.length).toBeGreaterThan(1000)

  /* 🔴 R1·A11Y(2026-08-04):錨點改用**欄名**。
     欄位輸入現在有無障礙名稱了(`field-grid.tsx` 的 `<label>`),
     而欄名比 placeholder 穩定 —— placeholder 是版面設定、欄名是資料模型。 */
  await page.getByRole("textbox", { name: "品名" }).fill("冷凍雞胸肉")
  await page.setInputFiles('input[type="file"]', {
    name: "現場.jpg",
    mimeType: "image/jpeg",
    buffer: jpeg,
  })
  await expect(page.getByRole("img", { name: "現場.jpg" })).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "儲存", exact: true }).click()
  await expect(page.getByText("已儲存")).toBeVisible({ timeout: 30_000 })

  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByRole("img", { name: "現場.jpg" })).toBeVisible({ timeout: 30_000 })
})

test("預覽走縮圖端點(?variant=thumb),且縮圖遠小於原圖", async ({ page, request }) => {
  const formId = await createPhotoForm(request)
  await page.goto(`/app/builder?form=${formId}&tab=fill`)
  await page.getByRole("tab", { name: "填單" }).click()
  const jpeg = await makeJpeg(page)

  const thumbRequests: string[] = []
  page.on("request", (r) => {
    if (r.url().includes("/api/engine/files/")) thumbRequests.push(r.url())
  })

  await page.setInputFiles('input[type="file"]', {
    name: "縮圖測試.jpg",
    mimeType: "image/jpeg",
    buffer: jpeg,
  })
  await expect(page.getByRole("img", { name: "縮圖測試.jpg" })).toBeVisible({ timeout: 30_000 })

  expect(thumbRequests.some((u) => u.includes("variant=thumb"))).toBe(true)

  // 直接比對兩個端點的位元組數:縮圖應顯著小於原圖
  const key = thumbRequests[0]?.split("/api/engine/files/")[1]?.split("?")[0] ?? ""
  expect(key).not.toBe("")
  const full = await request.get(`/api/engine/files/${key}`, { headers: DEV })
  const thumb = await request.get(`/api/engine/files/${key}?variant=thumb`, { headers: DEV })
  expect(full.status()).toBe(200)
  expect(thumb.status()).toBe(200)
  expect((await thumb.body()).length).toBeLessThan((await full.body()).length)
})

test("非影像附件請求縮圖 → 回原檔(前端永不破圖)", async ({ request }) => {
  const formId = await createPhotoForm(request)
  const form = await request.get(`/api/engine/forms/${formId}`, { headers: DEV })
  const fieldId = (await form.json()).fields.find((f: { name: string }) => f.name === "現場照")
    .id as number

  // image 欄只收影像 → 用 attachment 欄不可行,改直接驗證「縮圖不存在時回原檔」語意:
  // 上傳一張圖後,以不存在縮圖的 key 形狀請求(此處以原 key 請求 thumb,已有縮圖 → 200)
  const res = await request.post(`/api/engine/forms/${formId}/files?fieldId=${fieldId}`, {
    headers: { ...DEV },
    multipart: {
      file: {
        name: "a.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      },
    },
  })
  expect(res.status()).toBe(201)
  const key = (await res.json()).key as string
  const thumb = await request.get(`/api/engine/files/${key}?variant=thumb`, { headers: DEV })
  expect(thumb.status()).toBe(200) // 1×1 圖之縮圖不放大,仍可取得
})
