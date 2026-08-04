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

/* 🔴 audit-D §2.3|**不用打 API 就能把文字欄設成條碼顯示**。

   `showAsQr` 在欄位型別 registry 與 `barcode.tsx` 都存在,而 §4.2 / M2 / changelog
   都寫著它已落地 —— 但**全 repo 沒有任何寫入處**,只能打 API 設。
   第一約束逐字:「有 API 可以做」不算解決。

   範本是 `widgets.spec.ts` 的「不用打 API 就能建小圖表」——
   audit-D 的六條 🔴 裡有四條,是因為別的模組沒有這樣一條測試。 */
test("🔴 不用打 API 就能把文字欄設為條碼顯示(第一約束)", async ({ page, request }) => {
  const res = await request.post("/api/engine/forms", {
    headers: { "x-dev-tenant": "1", "content-type": "application/json" },
    data: {
      name: `E2E條碼開關_${String(Date.now()).slice(-6)}`,
      fields: [{ name: "料號", type: "text" }],
    },
  })
  const formId = ((await res.json()) as { id: number }).id

  await page.goto(`/app/builder?form=${String(formId)}`)
  /* ⚠️ 欄位格的無障礙名稱含示例值與兩顆內嵌按鈕(「料號 範例文字 拖曳 料號 下架 料號」),
     用 `/料號/` 會同時命中內嵌的「拖曳 / 下架」按鈕而點錯。挑最外層那一個。 */
  await page
    .getByRole("button", { name: /^料號 / })
    .first()
    .click()
  const toggle = page.getByLabel("以條碼 / QR 呈現")
  await expect(toggle).toBeVisible({ timeout: 30_000 })
  await expect(toggle).not.toBeChecked()
  /* ⚠️ 用 `click` 不用 `check`:這顆勾選框由**伺服器狀態**驅動(存完重抓才翻),
     而 `check()` 會斷言點擊當下狀態就改變 —— 那是對樂觀更新的假設,這裡沒有。
     單一真實來源優先於即時回饋,與同一面板的日期格式下拉同一形狀。 */
  await toggle.click()
  await expect(toggle).toBeChecked({ timeout: 15_000 })

  /* 存得進 options —— 畫面上勾了,後端要真的收到 */
  await expect(async () => {
    const got = await request.get(`/api/engine/forms/${String(formId)}`, {
      headers: { "x-dev-tenant": "1" },
    })
    const f = ((await got.json()) as { fields: { options: Record<string, unknown> }[] }).fields[0]
    expect(f?.options.showAsQr).toBe(true)
  }).toPass({ timeout: 15_000 })
})
