import { expect, test } from "@playwright/test"

/* F-2 M5 固化(承 MCP 走通):註冊公司工作區 → 進受保護區(頂帶顯示公司 + 帳號)
   → 登出回登入頁 → 登入回工作區、active org 正確解析。
   註:dev 後端走 DevTenantGuard(x-dev-tenant),前端強制登入僅 prod 生效;
   本 spec 驗證的是真實 auth UI + session + org 解析流程(login/register/logout 於 dev 亦真實運作)。 */

const uniq = (): string => Date.now().toString().slice(-6)

test("認證流程:註冊公司 → 進工作區 → 登出 → 登入", async ({ page }) => {
  const suffix = uniq()
  const email = `e2e_${suffix}@weyver.test`
  const orgName = `E2E廠_${suffix}`
  const password = "s3cret-passw0rd"

  // 1) 註冊:建帳號 + 建公司 org(後端 afterCreateOrganization hook 建 tenant + 連結)+ 設 active
  await page.goto("/register")
  await page.getByRole("textbox", { name: "公司名稱" }).fill(orgName)
  await page.getByRole("textbox", { name: "您的姓名" }).fill("測試員")
  await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await page.getByRole("textbox", { name: "密碼(至少 15 碼)" }).fill(password)
  await page.getByRole("button", { name: "建立並進入" }).click()

  // 進入受保護工作區;頂欄顯示公司名(email 收進登出鈕 tooltip,不佔版面)
  await expect(page).toHaveURL(/\/app\/builder/)
  await expect(page.getByText(orgName)).toBeVisible()

  // 2) 登出 → 回登入頁
  await page.getByRole("button", { name: "登出", exact: true }).click()
  await expect(page).toHaveURL(/\/login/)

  // 3) 登入 → 回工作區;新 session 之 active org 由登入流程設回 → 頂帶顯示公司名
  await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await page.getByRole("textbox", { name: "密碼" }).fill(password)
  await page.getByRole("button", { name: "登入" }).click()
  await expect(page).toHaveURL(/\/app\/builder/)
  await expect(page.getByText(orgName)).toBeVisible()
})
