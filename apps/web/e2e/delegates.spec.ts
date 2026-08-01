import { expect, test } from "@playwright/test"

/* #104|簽核代理人(瀏覽器端)。

   後端語意由 api 的 `approval.integration.test.ts` 對真 PG 固化(代理才簽得了 /
   期間失效 / 稽核記下代的是誰 / 不得繞過禁自簽)。本檔只固化**畫面上這一端**:
   使用者設得起來、看得出誰在代理誰、以及**代理人自己看不到取消鈕**
   —— 授權的一端必須留在授權者手上,那條規則在畫面上要看得見。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }

test.beforeEach(async ({ request }) => {
  /* dev DB 有狀態:上一輪留下的代理會讓「尚未指定」的起始斷言失敗 */
  const list = await request.get("/api/engine/approval-delegates", { headers: DEV })
  const body = (await list.json()) as { granted: { id: number }[] }
  for (const d of body.granted) {
    await request.delete(`/api/engine/approval-delegates/${String(d.id)}`, { headers: DEV })
  }
})

test("設定代理人:兩個方向都看得見,且代理人不得自行解除", async ({ page }) => {
  await page.goto("/app/settings/delegates")
  await expect(page.getByRole("heading", { name: "簽核代理人" })).toBeVisible({ timeout: 30_000 })

  /* 空狀態要講清楚後果,而不是只寫「無資料」 */
  await expect(page.getByText("經過你的單據會停在原地等你回來", { exact: false })).toBeVisible()

  const picker = page.getByLabel("代理人")
  await expect(picker.locator("option")).not.toHaveCount(1, { timeout: 30_000 })
  const value = await picker.locator("option").nth(1).getAttribute("value")
  expect(value).not.toBeNull()
  await picker.selectOption(value ?? "")
  await page.getByRole("button", { name: "新增" }).click()

  await expect(page.getByText("生效中")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: "取消" })).toBeVisible()

  /* 🔴 「我代理的人」區沒有取消鈕 —— 代理關係只能由指定的人解除 */
  const received = page.locator("section").filter({ hasText: "我代理的人" })
  await expect(received.getByText("代理關係只能由指定的人取消", { exact: false })).toBeVisible()
  await expect(received.getByRole("button", { name: "取消" })).toHaveCount(0)

  await page.getByRole("button", { name: "取消" }).first().click()
  await expect(page.getByText("經過你的單據會停在原地等你回來", { exact: false })).toBeVisible()
})

test("設定中心的「個人」區找得到簽核代理人", async ({ page }) => {
  await page.goto("/app/settings")
  const link = page.getByRole("link", { name: /簽核代理人/ })
  await expect(link).toBeVisible({ timeout: 30_000 })
  await link.click()
  await expect(page).toHaveURL(/\/app\/settings\/delegates/)
})
