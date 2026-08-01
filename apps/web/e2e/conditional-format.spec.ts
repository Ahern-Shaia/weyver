import { expect, test } from "@playwright/test"

/* R1·UP-3b M4 UI 固化:條件式格式。
   求值語意(運算子 / AND·OR / 後者覆蓋 / 欄位缺失)由 16 個前端單元測固化;
   後端契約(tone 白名單 / 運算子收斂)由 api integration 5 測固化。此處驗端到端。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "7" }
const uniq = () => Date.now().toString().slice(-6)

/* 兩條規則刻意重疊於「狀態」欄,用來驗證**後者覆蓋** */
const RULES = {
  record: [
    {
      combinator: "and",
      conditions: [{ field: "狀態", op: "eq", value: "待審" }],
      targets: ["狀態"],
      tone: "warn",
    },
    {
      combinator: "and",
      conditions: [{ field: "交期", op: "lt", value: "2026-08-01" }],
      targets: ["交期", "狀態"],
      tone: "error",
    },
  ],
  list: [
    {
      combinator: "and",
      conditions: [{ field: "狀態", op: "eq", value: "待審" }],
      targets: ["狀態"],
      tone: "warn",
    },
    {
      combinator: "and",
      conditions: [{ field: "交期", op: "lt", value: "2026-08-01" }],
      targets: ["交期", "狀態"],
      tone: "error",
    },
  ],
}

async function seedForm(request: import("@playwright/test").APIRequestContext): Promise<number> {
  const form = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E條件格式_${uniq()}`,
      fields: [
        { name: "單號", type: "text", required: true },
        { name: "交期", type: "date" },
        { name: "狀態", type: "singleSelect", options: { choices: ["草稿", "待審", "已核准"] } },
      ],
    },
  })
  expect(form.status()).toBe(201)
  const formId = (await form.json()).id as number

  for (const values of [
    { 單號: "PO-001", 交期: "2026-07-20", 狀態: "待審" }, // 逾期 + 待審 → 兩規則皆命中
    { 單號: "PO-002", 交期: "2026-09-05", 狀態: "待審" }, // 只命中規則 1
    { 單號: "PO-003", 交期: "2026-09-12", 狀態: "已核准" }, // 皆不命中
  ]) {
    await request.post(`/api/engine/forms/${formId}/records`, { headers: DEV, data: { values } })
  }
  await request.patch(`/api/engine/forms/${formId}/layout`, {
    headers: DEV,
    data: { fields: {}, conditionalFormats: RULES },
  })
  return formId
}

test("記錄頁:命中規則之欄位標題與值皆著色,且後者覆蓋前者", async ({ page, request }) => {
  const formId = await seedForm(request)
  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByText("基本資料").first()).toBeVisible({ timeout: 30_000 })

  // toHaveCSS 會自動重試 —— 條件式格式依賴 useLayout 查詢,一次性讀取會在它解析前就跑掉
  const label = (text: string) => page.getByText(text, { exact: true }).first()

  // 交期(僅規則 2)→ error;狀態(規則 1 warn 被規則 2 error 覆蓋)→ error
  await expect(label("交期")).toHaveCSS("color", "rgb(179, 38, 30)")
  await expect(label("狀態")).toHaveCSS("color", "rgb(179, 38, 30)")
  // 未命中之欄位維持預設灰
  await expect(label("單號")).not.toHaveCSS("color", "rgb(179, 38, 30)")
})

test("記錄頁:值以帶框章呈現且文字恆在(FMEA G7 色非唯一訊號)", async ({ page, request }) => {
  const formId = await seedForm(request)
  await page.goto(`/app/forms/${formId}?mode=record`)
  /* 🔴 日期以**當地格式**呈現(zh-TW → `2026/07/20`),不是資料庫的 ISO 原值。
     原本這裡斷言 `2026-07-20`,等於把「原樣印出內部表示」寫成規格。 */
  await expect(page.getByText("2026/07/20", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("待審", { exact: true }).first()).toBeVisible()
})

test("設計器:面板可開、規則清單與覆蓋序提示、即時預覽", async ({ page, request }) => {
  const formId = await seedForm(request)
  await page.goto(`/app/builder?form=${formId}`)
  await page.getByRole("button", { name: "條件式格式" }).click()

  await expect(page.getByText("排越後面越優先")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: /記錄頁/ })).toBeVisible()
  await expect(page.getByText("即時預覽(本表第一筆)")).toBeVisible()

  // 切到列表頁分頁 → 規則獨立呈現(兩面各一組)
  await page.getByRole("button", { name: "列表頁", exact: true }).click()
  await expect(page.getByText("排越後面越優先")).toBeVisible()
})

test("設計器:改規則顏色 → 即時預覽同步", async ({ page, request }) => {
  const formId = await seedForm(request)
  await page.goto(`/app/builder?form=${formId}`)
  await page.getByRole("button", { name: "條件式格式" }).click()
  await expect(page.getByText("排越後面越優先")).toBeVisible({ timeout: 30_000 })

  // 選第 2 條規則(error)→ 改成 c1;預覽中「交期」應改為 c1 藍
  await page.getByRole("button", { name: /交期.*小於/ }).click()
  await page.getByRole("button", { name: "顏色 c1" }).click()

  const previewDate = page.getByText("2026-07-20", { exact: true }).last()
  await expect(previewDate).toHaveCSS("color", "rgb(31, 95, 158)")
})
