import { expect, test } from "@playwright/test"

/* G-2 公開表單 UI 固化。

   🔴 這份 spec 存在的**主要理由**是抓一類整合測抓不到的東西:
   控制器少了 `@Inject()` → DI 注入 undefined → 路由 500。
   type-check 過、16 條整合測全綠(它們直接 new 服務、繞過 DI),
   只有真的把 app 跑起來打那條路由才會炸。第一個 case 就是這條防線。 */

const API = "http://localhost:3001/api"
const H = { "x-dev-tenant": "1", "content-type": "application/json" }
type Req = import("@playwright/test").APIRequestContext

async function seedShare(
  request: Req,
  stamp: string,
): Promise<{ token: string; formId: number; publicNames: string[]; secretName: string }> {
  const formRes = await request.post(`${API}/forms`, {
    headers: H,
    data: {
      name: `E2E公開_${stamp}`,
      fields: [
        { name: "公司名稱", type: "text", required: true },
        { name: "報價金額", type: "money" },
        { name: "內部成本", type: "money" },
      ],
    },
  })
  const form = (await formRes.json()) as { id: number; fields: { id: number; name: string }[] }
  const byName = Object.fromEntries(form.fields.map((f) => [f.name, f.id]))
  const shareRes = await request.post(`${API}/public-forms`, {
    headers: H,
    data: {
      formId: form.id,
      title: `E2E報價單_${stamp}`,
      // 刻意只開兩個 —— 「內部成本」是白名單要證明擋得住的那個
      fieldIds: [byName["公司名稱"], byName["報價金額"]],
    },
  })
  const share = (await shareRes.json()) as { token: string }
  return {
    token: share.token,
    formId: form.id,
    publicNames: ["公司名稱", "報價金額"],
    secretName: "內部成本",
  }
}

test("🔴 公開頁只渲染白名單欄位,且沒有任何內部 chrome", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const seeded = await seedShare(request, stamp)

  await page.goto(`/f/${seeded.token}`)
  await expect(page.getByRole("heading", { name: `E2E報價單_${stamp}` })).toBeVisible({
    timeout: 30_000,
  })

  for (const name of seeded.publicNames) {
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible()
  }
  // 未勾選的欄位不得出現
  await expect(page.getByText(seeded.secretName)).toBeHidden()

  /* 訪客不該看到任何內部導覽 —— 側欄、通知、租戶名稱都在 /app layout 裡,
     這頁刻意不用那層 */
  await expect(page.getByRole("link", { name: "我的表單" })).toBeHidden()
  await expect(page.getByRole("button", { name: "通知" })).toBeHidden()
})

test("🔴 提交後不進動態表,回執是不透明代碼", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const seeded = await seedShare(request, stamp)

  await page.goto(`/f/${seeded.token}`)
  await expect(page.getByRole("heading", { name: `E2E報價單_${stamp}` })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole("textbox", { name: /公司名稱/ }).fill(`外部廠商_${stamp}`)
  await page.getByRole("spinbutton", { name: "報價金額" }).fill("99000")
  /* 🔴 刻意等過「最短填寫時間」門檻(2 秒)。自動化填表只要幾百毫秒,
     正好落在機器人的特徵區間而被擋 —— 這證明那道防護是活的,不是裝飾。 */
  await page.waitForTimeout(2500)
  await page.getByRole("button", { name: "送出" }).click()

  await expect(page.getByText("已收到你的填寫內容")).toBeVisible({ timeout: 15_000 })
  /* 回執是 HMAC 導出的不透明代碼,不是流水號 —— 連號會洩漏業務量 */
  await expect(page.locator("code")).toHaveText(/^R-[A-Z0-9_-]+$/)

  // 動態表此刻必須仍是空的(隔離的 structural 保證)
  const records = await request.get(`${API}/forms/${String(seeded.formId)}/records?limit=10`, {
    headers: { "x-dev-tenant": "1" },
  })
  const body = (await records.json()) as { records: unknown[] }
  expect(body.records).toHaveLength(0)
})

test("待審收件匣核准後才建立正式記錄", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const seeded = await seedShare(request, stamp)
  const company = `待審廠商_${stamp}`

  await request.post(`${API}/public/forms/${seeded.token}/submit`, {
    headers: { "content-type": "application/json" },
    data: { values: { 公司名稱: company, 報價金額: "5000" } },
  })

  await page.goto("/app/settings/public-forms")
  const row = page.getByRole("listitem").filter({ hasText: company })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole("button", { name: "核准建立" }).click()
  await expect(row).toBeHidden({ timeout: 15_000 })

  const records = await request.get(`${API}/forms/${String(seeded.formId)}/records?limit=10`, {
    headers: { "x-dev-tenant": "1" },
  })
  const body = (await records.json()) as { records: { values: Record<string, unknown> }[] }
  expect(body.records.map((r) => r.values["公司名稱"])).toContain(company)
})

test("關閉後訪客看到關閉訊息,不洩漏表單是否存在", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const seeded = await seedShare(request, stamp)
  const list = await request.get(`${API}/public-forms`, { headers: H })
  const shares = (await list.json()) as { shares: { id: number; title: string }[] }
  const share = shares.shares.find((s) => s.title === `E2E報價單_${stamp}`)
  /* 無 body 的 POST **不可**帶 content-type: application/json ——
     Fastify 會回「Body cannot be empty」。只帶租戶標頭。 */
  await request.post(`${API}/public-forms/${String(share?.id)}/close`, {
    headers: { "x-dev-tenant": "1" },
  })

  await page.goto(`/f/${seeded.token}`)
  await expect(page.getByText("這個表單目前無法填寫。")).toBeVisible({ timeout: 30_000 })

  // 亂編的 token 顯示**完全相同**的訊息 —— 否則可用試 token 探測表單是否存在
  await page.goto("/f/totally-made-up-token-value")
  await expect(page.getByText("這個表單目前無法填寫。")).toBeVisible({ timeout: 15_000 })
})
