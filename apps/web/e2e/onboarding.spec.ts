import { expect, test } from "@playwright/test"

/* 🔴 R1·A-1|新同事入職的完整迴圈:管理員建帳號 → 新人用初始密碼登入
   → **被擋下要求自設密碼** → 設完才進得去。

   ASVS 5.0.0 §V6.4.1 逐字:初始密碼「must not be permitted to become the
   long term password」。M2 建了 `initial_credential` 卻沒有任何地方執法 ——
   這支 spec 就是那條執法路徑的守門人。

   ⚠️ 本檔**不註冊新公司**(用 dev 租戶既有的 org):註冊 / 登入端點限流
   5 次/分且整套 e2e 共用同一來源 IP,見 `global-setup.ts` 的說明。
   這裡只花一次登入額度。 */

const uniq = (): string => Date.now().toString().slice(-6)

test("🔴 入職:初始密碼只能用一次,設完自己的密碼才進得去", async ({ page, browser }) => {
  const suffix = uniq()
  const email = `newhire_${suffix}@weyver.test`

  // 管理員在成員頁建帳號,拿到系統產生的初始密碼
  await page.goto("/app/settings/members")
  await expect(page.getByRole("heading", { name: "成員" })).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "新增成員" }).click()
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("姓名").fill(`新同事_${suffix}`)
  await page.getByRole("button", { name: "建立並產生密碼" }).click()
  await expect(page.getByText("這組密碼只顯示這一次")).toBeVisible({ timeout: 30_000 })
  const initial = ((await page.locator("code").first().textContent()) ?? "").trim()
  expect(initial).toHaveLength(15)

  // 新同事在自己的瀏覽器用初始密碼登入
  const hire = await browser.newContext()
  const hirePage = await hire.newPage()
  await hirePage.goto("/login")
  await hirePage.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await hirePage.getByRole("textbox", { name: "密碼" }).fill(initial)
  await hirePage.getByRole("button", { name: "登入" }).click()

  /* 🔴 登入成功但**進不了工作區** —— 後端每一支 API 都回 PASSWORD_CHANGE_REQUIRED,
     前端統一導到設定密碼頁。修正前:初始密碼可以永遠用下去。 */
  await expect(hirePage).toHaveURL(/\/set-password/, { timeout: 30_000 })
  await expect(hirePage.getByRole("heading", { name: "請設定你自己的密碼" })).toBeVisible()

  // 設定自己的密碼 → 閘門解除
  const own = `Hx7-vQm${suffix}-Ztp2`
  /* 🔴 **填寫與送出要一起重試,直到頁面真的 hydrate**。這一頁是整頁導向過來的,
     在 hydration 完成之前互動會有兩種壞法,而且兩種都不像「還沒好」:
       · 填得進去但 React 接手時把受控輸入框重設 → 送出**空密碼**
         → 後端回「密碼至少 15 個字」,看起來像功能壞掉
       · 送出時 onSubmit 尚未掛上 → 走**原生 GET**,網址變成 `/set-password?`
     兩者都只在整套跑時出現(單獨跑時頁面早已編譯、hydration 快),
     所以不能靠「單獨跑得過」就當作沒事。 */
  await expect(async () => {
    await hirePage.getByLabel("管理員給的初始密碼").fill(initial)
    await hirePage.getByLabel("你的新密碼(至少 15 碼)").fill(own)
    await hirePage.getByRole("button", { name: "設定並進入" }).click()
    await expect(hirePage).toHaveURL(/\/app/, { timeout: 8_000 })
  }).toPass({ timeout: 40_000 })
  await expect(hirePage).not.toHaveURL(/\/set-password/)

  await hire.close()
})
