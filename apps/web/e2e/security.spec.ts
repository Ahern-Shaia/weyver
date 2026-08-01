import { expect, test } from "@playwright/test"
import { registerOrg } from "./register"

/* R1·A-1 M3|帳號安全頁。

   後端規格(只看自己的 / 撤金鑰 / 保留 6 個月)由 api 的 `security.integration.test.ts`
   對真 PG 固化;本檔固化**瀏覽器這一端**的三條介面性質,每條都有明確理由:

   1. **標出「目前這台」** —— 否則沒人敢按登出,怕把自己踢掉。
   2. **副作用寫在按下去之前** —— 強制登出會連帶撤銷 API 金鑰
      (Google 官方自陳登出「except…」不完全,我們做完整;做得更多就更要先講)。
   3. **登入紀錄看得到** —— 這頁存在的理由就是讓使用者自己發現異常。 */

const uniq = (): string => Date.now().toString().slice(-6)

test("🔴 帳號安全:標出目前這台 → 撤銷副作用先講 → 登入紀錄看得到", async ({ page, browser }) => {
  const suffix = uniq()
  const email = `sec_${suffix}@weyver.test`
  const password = "s3cret-passw0rd"

  await registerOrg(page, {
    orgName: `安全廠_${suffix}`,
    name: "安全員",
    email: email,
    password: password,
  })

  /* 另一個 context = 另一台裝置。沒有它就只有一台在線,
     「登出其他所有裝置」按鈕**本來就該是關的**(這是正確行為,不是缺陷)。 */
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await otherPage.goto("/login")
  await otherPage.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await otherPage.getByRole("textbox", { name: "密碼" }).fill(password)
  await otherPage.getByRole("button", { name: "登入" }).click()
  await expect(otherPage).toHaveURL(/\/app/)
  await other.close()

  await page.goto("/app/settings/security")
  await expect(page.getByRole("heading", { name: "帳號安全" })).toBeVisible({ timeout: 30_000 })

  /* 🔴 (1) 剛註冊完就在線上 —— 這台一定要標出來 */
  await expect(page.getByText("目前這台")).toBeVisible({ timeout: 30_000 })

  /* 🔴 (2) 副作用要在按下去**之前**看得到,不是按完才知道 */
  await page.getByRole("button", { name: "登出其他所有裝置" }).click()
  await expect(page.getByText("一併撤銷你名下所有 API 金鑰")).toBeVisible()
  await page.getByRole("button", { name: "取消" }).click()

  /* 🔴 (3) 剛才的註冊要在紀錄裡 —— 這頁的用途就是讓使用者自己發現異常。
     空白的紀錄頁看起來跟「壞掉」無法區分,所以建立帳號本身也記一筆。 */
  await expect(page.getByText("建立帳號").first()).toBeVisible({ timeout: 30_000 })
})
