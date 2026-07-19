import { expect, test } from "@playwright/test"
import { authenticator } from "otplib"

/* F-4 MFA 固化(承 MCP 走通):註冊 → 帳號設定啟用 TOTP(otplib 由畫面 secret 產碼)
   → 已啟用 → 登出 → 登入密碼步後導二步 → 輸入 TOTP → 進工作區。
   註:dev 後端不強制登入,但 login/2FA/session 均真實運作;此 spec 驗證真實 2FA UI 流程。 */

const uniq = (): string => Date.now().toString().slice(-6)

test("MFA:啟用 TOTP → 登出 → 登入需二步 → 驗證進工作區", async ({ page }) => {
  const suffix = uniq()
  const email = `mfa_${suffix}@weyver.test`
  const orgName = `MFA廠_${suffix}`
  const password = "s3cret-passw0rd"

  // 註冊公司
  await page.goto("/register")
  await page.getByRole("textbox", { name: "公司名稱" }).fill(orgName)
  await page.getByRole("textbox", { name: "您的姓名" }).fill("安全員")
  await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await page.getByRole("textbox", { name: "密碼(至少 8 碼)" }).fill(password)
  await page.getByRole("button", { name: "建立並進入" }).click()
  await expect(page).toHaveURL(/\/app\/builder/)

  // 啟用 2FA:密碼 → enable → 讀畫面 secret 產碼 → verifyTotp
  await page.goto("/app/settings/security")
  await page.getByPlaceholder("••••••••").fill(password)
  await page.getByRole("button", { name: "啟用二步驟驗證" }).click()

  const secret = ((await page.getByTestId("totp-secret").textContent()) ?? "").trim()
  expect(secret.length).toBeGreaterThan(0)
  await page.getByPlaceholder("123456").fill(authenticator.generate(secret))
  await page.getByRole("button", { name: "完成啟用" }).click()
  await expect(page.getByText("已啟用")).toBeVisible()

  // 登出 → 登入 → 密碼步後導二步
  await page.getByRole("button", { name: "登出" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await page.getByRole("textbox", { name: "密碼" }).fill(password)
  await page.getByRole("button", { name: "登入" }).click()
  await expect(page).toHaveURL(/\/login\/2fa/)

  // 輸入 TOTP → 發完整 session → 進工作區,頂帶顯示公司名
  await page.locator("input[autocomplete='one-time-code']").fill(authenticator.generate(secret))
  await page.getByRole("button", { name: "驗證並登入" }).click()
  await expect(page).toHaveURL(/\/app\/builder/)
  await expect(page.getByText(orgName)).toBeVisible()
})
