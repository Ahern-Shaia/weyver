import { type Page, expect } from "@playwright/test"

/* 🔴 註冊共用步驟 + **限流退讓**。

   `/sign-up/email` 的 per-IP 限流是 5 次 / 60 秒(auth.ts customRules)——
   這是**要留著的 prod 控制**,不該為了測試好跑就調鬆。但整套 e2e 有三支測試會註冊公司,
   連著跑就會撞到,症狀是停在 /register、看起來像註冊功能壞了。

   故這裡不動限流,改在測試端**等過視窗再重試一次**:限流仍被真實執行,
   紅燈也不再是時間巧合造成的。 */

const RATE_LIMIT_WINDOW_MS = 61_000

export async function registerOrg(
  page: Page,
  {
    orgName,
    name,
    email,
    password,
  }: { orgName: string; name: string; email: string; password: string },
): Promise<void> {
  const fill = async (): Promise<void> => {
    await page.goto("/register")
    await page.getByRole("textbox", { name: "公司名稱" }).fill(orgName)
    await page.getByRole("textbox", { name: "您的姓名" }).fill(name)
    await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
    await page.getByRole("textbox", { name: "密碼(至少 15 碼)" }).fill(password)
    await page.getByRole("button", { name: "建立並進入" }).click()
  }

  await fill()
  if (
    await page.waitForURL(/\/app\/builder/, { timeout: 8000 }).then(
      () => true,
      () => false,
    )
  ) {
    return
  }

  const reason = (
    await page
      .locator("form")
      .innerText()
      .catch(() => "")
  ).replace(/\n/g, " ")
  await page.waitForTimeout(RATE_LIMIT_WINDOW_MS)
  await fill()
  await expect(page, `註冊第二次仍未進入工作區(第一次的畫面訊息:${reason})`).toHaveURL(
    /\/app\/builder/,
    { timeout: 15_000 },
  )
}
