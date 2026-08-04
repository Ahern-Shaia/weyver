import { expect, test } from "@playwright/test"

/* R1·UP-4 field-types-parity M4 UI 固化:進階型別 palette(系統欄/lookup/rollup/link/barcode)+
   設定編輯器。引擎(讀時計算/autoNumber pattern/選項/link)由 api integration 測固化,此 spec 固化設計器 UI。 */

test("進階型別:palette + 設定編輯器渲染", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("進階 · 計算/關聯")).toBeVisible({ timeout: 30_000 })

  /* 🔴 收斂到 palette。整頁範圍的 role 查詢會撞到**左欄的表單清單** ——
     只要有人建一張名字含「條碼」的表,這一條就 strict mode violation,
     而失敗訊息指向的是選取器不是原因。同型踩坑本 repo 已記錄過。 */
  const palette = page
    .locator("div")
    .filter({ hasText: /^點擊加入/ })
    .first()
  await expect(palette.getByRole("button", { name: /彙總/ })).toBeVisible()
  await expect(palette.getByRole("button", { name: /帶入/ })).toBeVisible()
  await expect(palette.getByRole("button", { name: /關聯/ })).toBeVisible()
  await expect(palette.getByRole("button", { name: /條碼/ })).toBeVisible()

  // 彙總編輯器:子表選擇 + 聚合函式
  await palette.getByRole("button", { name: /彙總/ }).click()
  await expect(page.getByText("加入彙總欄位")).toBeVisible()
  await expect(page.getByRole("option", { name: "加總" })).toBeAttached() // fn 選項
})

test("進階型別:自動編號 pattern 設定(日期段 + 重設)", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("進階 · 計算/關聯")).toBeVisible({ timeout: 30_000 })
  // 自動編號在主 palette(.first():避開 canvas 上型別=自動編號的欄位卡)
  await page
    .locator("div")
    .filter({ hasText: /^點擊加入/ })
    .first()
    .getByRole("button", { name: /自動編號/ })
    .click()
  await expect(page.getByText("加入自動編號欄位")).toBeVisible()
  // pattern 控制:日期段 + 重設範圍
  await expect(page.getByRole("option", { name: "yyyyMM", exact: true })).toBeAttached()
  await expect(page.getByRole("option", { name: "每月重設" })).toBeAttached()
})

/* 🔴 audit-D §2.4|**連動選項**。此前 `parentField` / `choices[].parents` 只有 schema:
   設計器沒有入口、填單不過濾、後端不驗 —— 打 API 設了也不會有任何效果,
   而 `field-types-parity` 把它列為 P0 且標 SHIPPED。

   這一條同時釘住三面。**三面都要**:少了後端就是裝飾(直接打 API 繞過),
   少了設計器就違反第一約束,少了填單過濾則是「選得到卻存不進去」。 */
test("🔴 連動選項:設計器可設、填單依父欄收窄、伺服器擋得住", async ({ page, request }) => {
  const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E連動_${String(Date.now()).slice(-6)}`,
      fields: [
        { name: "大類", type: "singleSelect", options: { choices: ["飲料", "食品"] } },
        { name: "品項", type: "singleSelect", options: { choices: ["紅茶", "餅乾", "其他"] } },
      ],
    },
  })
  const formId = ((await res.json()) as { id: number }).id

  // 1) 設計器:指定父欄 + 逐選項指定可出現的父值
  await page.goto(`/app/builder?form=${String(formId)}`)
  await page
    .getByRole("button", { name: /^品項 / })
    .first()
    .click()
  const parentPicker = page.getByLabel("連動於")
  await expect(parentPicker).toBeVisible({ timeout: 30_000 })
  await parentPicker.selectOption("大類")
  await page.getByRole("button", { name: "紅茶 連動 飲料" }).click()
  await page.getByRole("button", { name: "餅乾 連動 食品" }).click()

  await expect(async () => {
    const got = await request.get(`/api/engine/forms/${String(formId)}`, { headers: DEV })
    const f = (
      (await got.json()) as { fields: { name: string; options: Record<string, unknown> }[] }
    ).fields.find((x) => x.name === "品項")
    expect(f?.options.parentField).toBe("大類")
  }).toPass({ timeout: 15_000 })

  // 2) 填單:父欄未選 → 只剩不受限的選項;選了飲料 → 換成紅茶
  await page.goto(`/app/builder?form=${String(formId)}&mode=fill`)
  await page.getByRole("tab", { name: "填單" }).click()
  const 品項 = page.getByRole("combobox", { name: "品項" })
  await expect(品項).toBeVisible({ timeout: 30_000 })
  await expect(品項.locator("option")).toHaveText(["—", "其他"])

  await page.getByRole("combobox", { name: "大類" }).selectOption("飲料")
  await expect(品項.locator("option")).toHaveText(["—", "紅茶", "其他"])

  // 3) 🔴 伺服器:繞過畫面直接打 API,父子不符照樣擋
  const bad = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: DEV,
    data: { values: { 大類: "食品", 品項: "紅茶" } },
  })
  expect(bad.status()).toBe(422)
  expect(JSON.stringify(await bad.json())).toContain("不屬於目前的")

  const ok = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: DEV,
    data: { values: { 大類: "飲料", 品項: "紅茶" } },
  })
  expect(ok.status()).toBe(201)
})
