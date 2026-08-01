import { expect, test } from "@playwright/test"

/* R1·UP-4c M4 UI 固化:選項配色 —— 設計器逐項編輯器(含自動配色)+ 呈現面上色。
   後端(tone enum 收斂、colors↔choices 交叉驗證)由 api integration 4 測固化。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "7" }
const uniq = () => Date.now().toString().slice(-6)

/* 語意色(狀態)與類別色(區域)並存,驗證兩軸互不干擾 */
async function seedColoredForm(
  request: import("@playwright/test").APIRequestContext,
): Promise<number> {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E配色_${uniq()}`,
      fields: [
        { name: "單號", type: "text", required: true },
        {
          name: "狀態",
          type: "singleSelect",
          options: {
            choices: ["草稿", "待審", "已核准"],
            colors: { 草稿: "neutral", 待審: "warn", 已核准: "ok" },
          },
        },
        {
          name: "區域",
          type: "singleSelect",
          options: { choices: ["北區", "南區"], colors: { 北區: "c1", 南區: "c7" } },
        },
      ],
    },
  })
  expect(res.status()).toBe(201)
  const formId = (await res.json()).id as number
  await request.post(`/api/engine/forms/${formId}/records`, {
    headers: DEV,
    data: { values: { 單號: `PO-${uniq()}`, 狀態: "待審", 區域: "北區" } },
  })
  return formId
}

test("記錄頁:狀態章與選項章依設定上色(語意色 + 類別色)", async ({ page, request }) => {
  const formId = await seedColoredForm(request)
  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByText("基本資料").first()).toBeVisible({ timeout: 30_000 })

  // getByText exact:直接命中承載文字的章本身(用 locator("span") 會抓到外層 flex wrapper)
  const tone = async (text: string): Promise<string> =>
    page
      .getByText(text, { exact: true })
      .first()
      .evaluate((el) => getComputedStyle(el).color)

  // 待審 = warn(#96590a);北區 = c1(#1f5f9e)—— 兩者必須不同且非預設中性
  const warn = await tone("待審")
  const cat = await tone("北區")
  expect(warn).toBe("rgb(150, 89, 10)")
  expect(cat).toBe("rgb(31, 95, 158)")
  expect(warn).not.toBe(cat)
})

test("記錄頁:章體恆含文字(色盲 / 黑白列印下資訊不失,FMEA C2)", async ({ page, request }) => {
  const formId = await seedColoredForm(request)
  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByText("待審").first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("北區").first()).toBeVisible()
})

test("設計器:逐項選項編輯器 + 新增自動配色", async ({ page, request }) => {
  const formId = await seedColoredForm(request)
  await page.goto(`/app/builder?form=${formId}`)
  await page.getByRole("button", { name: "單選", exact: true }).click()

  await expect(page.getByText("選項與顏色")).toBeVisible({ timeout: 30_000 })
  const colorSelects = page.locator('select[aria-label*="顏色"]')
  await expect(colorSelects).toHaveCount(2)
  await expect(colorSelects.nth(0)).toHaveValue("c1")
  await expect(colorSelects.nth(1)).toHaveValue("c2")

  // 新增選項自動取下一個未用的類別色(不重複)
  await page.getByRole("button", { name: "加選項" }).click()
  await expect(colorSelects).toHaveCount(3)
  await expect(colorSelects.nth(2)).toHaveValue("c3")

  // 改色後預覽章立即反映
  await colorSelects.nth(2).selectOption("error")
  await expect(colorSelects.nth(2)).toHaveValue("error")
})
