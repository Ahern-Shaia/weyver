import { expect, test } from "@playwright/test"

/* R1·A-1 M1|設定中心。

   後端的繼承語意由 api 的 `settings.integration.test.ts` 對真 PG 固化(17 條);
   本檔只固化**瀏覽器這一端**:使用者看不看得出「現在是跟隨公司、還是自己設的」,
   以及**退回繼承那條路走不走得通**。

   後者是本模組最容易漏的:少了它,使用者一旦動過設定就永遠回不去繼承。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }

/* 每個案例先把個人設定歸零 —— dev DB 有狀態,不歸零的話「跟隨公司設定」的
   起始斷言會被上一輪的自訂值污染。 */
async function resetMine(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const res = await request.patch("/api/engine/settings/me", {
    headers: DEV,
    data: { locale: null, displayTimezone: null },
  })
  expect(res.status()).toBe(200)
}

test("設定中心分「公司」與「個人」兩區,不是平鋪一張清單", async ({ page }) => {
  await page.goto("/app/settings")
  /* 區塊標題的 accessible name 含後面的提示文字(「公司 影響整個公司的所有人」),
     故用前綴比對而非 exact */
  await expect(page.getByRole("heading", { name: /^公司\s/ })).toBeVisible()
  await expect(page.getByRole("heading", { name: /^個人\s/ })).toBeVisible()
  /* 分區的意義在於使用者看得出「改這個會不會影響同事」 */
  await expect(page.getByText("影響整個公司的所有人")).toBeVisible()
  await expect(page.getByText("只影響你自己")).toBeVisible()
})

test("公司設定:業務時區的說明必須講清楚它不是顯示時區", async ({ page }) => {
  await page.goto("/app/settings/company")
  await expect(page.getByRole("heading", { name: "公司設定" })).toBeVisible({ timeout: 30_000 })
  /* 🔴 `tenants.timezone` 是 autoNumber 日期段的依據。若使用者把它當成
     「我要看到的時間」而隨手改掉,已列印憑證上的單號日期段就錯了且收不回來。 */
  const tz = page.getByText("決定單號日期段與各項期間的「一天」從何時開始", { exact: false })
  await expect(tz).toBeVisible()
  await expect(tz).toContainText("這不是顯示時區")
})

test("🔴 個人設定:繼承 → 自訂 → 改回繼承,整條路走得通", async ({ page, request }) => {
  await resetMine(request)
  await page.goto("/app/settings/profile")
  await expect(page.getByRole("heading", { name: "個人設定" })).toBeVisible({ timeout: 30_000 })

  // 1) 起始為繼承 —— 且要說得出跟隨的是什麼值
  const tzRow = page
    .locator("div")
    .filter({ hasText: /^顯示時區/ })
    .first()
  await expect(page.getByText(/跟隨公司設定\(Asia\/Taipei\)/)).toBeVisible()
  await expect(page.getByRole("button", { name: "改回跟隨公司設定" })).toHaveCount(0)

  // 2) 自訂 → 標示「已自訂」,並出現退回的路
  await tzRow.getByRole("combobox").selectOption("Asia/Tokyo")
  await expect(page.getByText("已自訂")).toBeVisible()
  await expect(page.getByRole("button", { name: "改回跟隨公司設定" })).toBeVisible()

  // 3) 退回繼承 —— 少了這條路,使用者一旦動過就永遠回不去
  await page.getByRole("button", { name: "改回跟隨公司設定" }).click()
  await expect(page.getByText(/跟隨公司設定\(Asia\/Taipei\)/)).toBeVisible()
  await expect(page.getByRole("button", { name: "改回跟隨公司設定" })).toHaveCount(0)
})

/* 🔴 動態繼承的使用者可見版本:改公司預設,未自訂者的畫面**立刻**跟著變。
   若實作成「建帳號時複製」,這條會紅。 */
test("🔴 改公司預設語言 → 未自訂者的個人設定即時跟著變", async ({ page, request }) => {
  await resetMine(request)
  await request.patch("/api/engine/settings/tenant", {
    headers: DEV,
    data: { defaultLocale: "zh-Hant" },
  })

  await page.goto("/app/settings/profile")
  await expect(page.getByText("跟隨公司設定(繁體中文)")).toBeVisible({ timeout: 30_000 })

  // 由公司設定頁改預設語言
  await page.goto("/app/settings/company")
  await page.getByLabel("預設語言").selectOption("en")
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText("已儲存")).toBeVisible()

  // 回個人設定:未自訂 → 跟著變成 English
  await page.goto("/app/settings/profile")
  await expect(page.getByText("跟隨公司設定(English)")).toBeVisible({ timeout: 30_000 })
})
