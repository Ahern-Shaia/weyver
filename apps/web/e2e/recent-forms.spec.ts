import { expect, test } from "@playwright/test"

/* R1·UX-1 M4|最近使用(IA 三層防線之第二層)。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }
const uniq = (): string => Date.now().toString().slice(-6)

test("開過表單後,首頁「最近使用」出現該表單且可點回", async ({ page, request }) => {
  const name = `E2E最近_${uniq()}`
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name, fields: [{ name: "品名", type: "text" }] },
  })
  expect(res.status()).toBe(201)
  const formId = (await res.json()).id as number

  // 首頁一開始不該有這張表在「最近使用」
  await page.goto("/app")
  const recent = page.locator("section", { has: page.getByText("最近使用", { exact: true }) })
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 })
  const hadBefore = (await recent.count()) > 0 && (await recent.getByText(name).count()) > 0
  expect(hadBefore).toBe(false)

  // 開啟表單 → 回首頁
  await page.goto(`/app/forms/${String(formId)}`)
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 })
  await page.goto("/app")

  await expect(recent).toBeVisible({ timeout: 30_000 })
  await expect(recent.getByText(name)).toBeVisible()

  // 可點回該表單
  await recent.getByText(name).click()
  await expect(page).toHaveURL(new RegExp(`/app/forms/${String(formId)}`))
})

/* 🔴 FMEA U5(P0)|localStorage 跨分頁共用 → 換租戶不得看到前一個租戶的最近使用。 */
test("換租戶後看不到前一租戶的最近使用", async ({ page, request }) => {
  const name = `E2E隔離_${uniq()}`
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name, fields: [{ name: "品名", type: "text" }] },
  })
  const formId = (await res.json()).id as number

  await page.goto(`/app/forms/${String(formId)}`)
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 })
  await page.goto("/app")
  const recent = page.locator("section", { has: page.getByText("最近使用", { exact: true }) })
  await expect(recent.getByText(name)).toBeVisible({ timeout: 30_000 })

  // 切到另一個租戶 scope(dev 下即 x-dev-tenant)→ 最近使用不得帶過去
  await page.evaluate(() => {
    window.localStorage.setItem("weyver.devTenant", "2")
  })
  await page.goto("/app")
  await expect(recent.getByText(name)).toHaveCount(0)
})
