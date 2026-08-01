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
  await page.getByRole("textbox", { name: "密碼(至少 15 碼)" }).fill(password)
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
  await page.getByRole("button", { name: "登出", exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await page.getByRole("textbox", { name: "密碼" }).fill(password)
  await page.getByRole("button", { name: "登入" }).click()
  await expect(page).toHaveURL(/\/login\/2fa/)

  /* 🔴 RFC 6238 §5.2:「The verifier MUST NOT accept the second attempt of the OTP
     after the successful validation has been issued for the first OTP.」
     啟用時已在這個 time step 驗過一次 → 同一組碼再用必須被擋。

     這一段原本是**偶發失敗的來源**(兩次驗證落在同一個 30 秒窗就紅),
     追 #126 時才看清那不是測試不穩,是重放防護正確生效。改成明確斷言,
     順帶釘住「訊息要說得出該怎麼辦」—— 原本一律顯示「驗證碼錯誤」,
     使用者會一直重打螢幕上那組看起來還有效的碼,永遠不會成功。 */
  const otp = page.locator("input[autocomplete='one-time-code']")
  await otp.fill(authenticator.generate(secret))
  await page.getByRole("button", { name: "驗證並登入" }).click()
  await expect(page.getByText("此驗證碼已使用過,請等 app 換下一組再輸入")).toBeVisible()
  await expect(page).toHaveURL(/\/login\/2fa/)

  /* ⚠️ 被判重放後**必須重新登入**,不能在原頁等下一組碼:重放偵測會撤銷剛發出的
     session(`totp-replay.ts` 的 revokeSessionByToken),2FA challenge 一併失效。
     實測在原頁輸入下一個 time step 的新碼仍被拒(且訊息退回通用的「驗證碼錯誤」)。
     這是**現況行為的記錄**,不是本測試的偏好 —— 若日後決定讓 challenge 在重放後存活,
     這一段就會紅,那正是它該提醒的時機。 */
  await page.goto("/login")
  await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await page.getByRole("textbox", { name: "密碼" }).fill(password)
  await page.getByRole("button", { name: "登入" }).click()
  await expect(page).toHaveURL(/\/login\/2fa/)

  // 等到下一個 time step 才會有新碼(step = 30 秒;+2 秒緩衝避開邊界)
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 2_000)

  // 新一組碼 → 發完整 session → 進工作區,頂帶顯示公司名
  await page.locator("input[autocomplete='one-time-code']").fill(authenticator.generate(secret))
  await page.getByRole("button", { name: "驗證並登入" }).click()
  await expect(page).toHaveURL(/\/app\/builder/)
  await expect(page.getByText(orgName)).toBeVisible()
})
