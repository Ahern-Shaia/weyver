import { expect, test } from "@playwright/test"

/* R1·後續-2 M5 UI 固化:條碼欄 QR 渲染 + 標籤設計器 + 標籤列印頁(份數展開/平舖)+ 列印設定。
   引擎(label_def CRUD/驗證/跨租戶)由 api integration 8 測固化。
   自建獨立表單以免依賴 dev DB 既有狀態。 */

const uniq = () => Date.now().toString().slice(-6)

async function createFormWithBarcode(request: import("@playwright/test").APIRequestContext) {
  const name = `E2E標籤_${uniq()}`
  const form = await request.post("/api/engine/forms", {
    headers: { "x-dev-tenant": "1", "x-dev-actor": "7" },
    data: {
      name,
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "批號", type: "barcode" },
        { name: "張數", type: "number" },
      ],
    },
  })
  const formId = (await form.json()).id as number
  await request.post(`/api/engine/forms/${formId}/records`, {
    headers: { "x-dev-tenant": "1", "x-dev-actor": "7" },
    data: { values: { 品名: "冷凍雞腿", 批號: `LOT-${uniq()}`, 張數: 2 } },
  })
  return { formId, name }
}

test("條碼欄:記錄頁渲染 QR(SVG)", async ({ page, request }) => {
  const { formId } = await createFormWithBarcode(request)
  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByText("基本資料").first()).toBeVisible({ timeout: 30_000 })
  // qrcode.react 產出 <svg>;批號欄位置應有 QR
  await expect(page.locator("svg").first()).toBeVisible()
  await expect(page.getByText(/^LOT-/)).toBeVisible()
})

test("標籤:設計器建立 → 列印頁依份數展開 + 平舖", async ({ page, request }) => {
  const { formId } = await createFormWithBarcode(request)

  // 經 API 建標籤定義(設計器 UI 另測),份數依「張數」=2
  const label = await request.post(`/api/engine/forms/${formId}/labels`, {
    headers: { "x-dev-tenant": "1", "x-dev-actor": "7" },
    data: {
      name: "E2E標籤",
      config: {
        size: { widthMm: 50, heightMm: 30 },
        tile: true,
        gapMm: 2,
        showFieldNames: false,
        copiesField: "張數",
        items: [{ field: "品名" }, { field: "批號", asQr: true }],
      },
    },
  })
  expect(label.status()).toBe(201)
  const labelId = (await label.json()).id as number

  await page.goto(`/app/forms/${formId}/labels/${labelId}/print`)
  await expect(page.getByTestId("label-sheet")).toBeVisible({ timeout: 30_000 })
  // 張數=2 → 展開 2 張標籤
  await expect(page.getByTestId("label-unit")).toHaveCount(2)
  await expect(page.getByText("2 張 · 平舖")).toBeVisible()
  await expect(page.getByRole("button", { name: "列印" })).toBeVisible()
})

test("設計器:標籤頁籤 + 列印設定面板", async ({ page, request }) => {
  const { formId } = await createFormWithBarcode(request)
  await page.goto(`/app/builder?form=${formId}`)
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })

  // 標籤設計器(動作/簽核側欄之「標籤」頁籤)
  await page.getByRole("button", { name: "動作/簽核" }).click()
  await page.getByRole("button", { name: "標籤", exact: true }).click()
  await expect(page.getByPlaceholder("標籤名稱")).toBeVisible()
  await expect(page.getByRole("button", { name: "加欄位" })).toBeVisible()
  await expect(page.getByRole("button", { name: "建立標籤" })).toBeVisible()

  // 列印設定面板(逐列頁首/頁尾/換頁 + 紙張委派瀏覽器之誠實說明)
  await page.getByRole("button", { name: "列印", exact: true }).click()
  await expect(page.getByText("列印設定")).toBeVisible()
  await expect(page.getByText(/由瀏覽器列印對話框設定/)).toBeVisible()
  await expect(page.getByRole("checkbox", { name: /設為列印頁首/ }).first()).toBeVisible()
})
