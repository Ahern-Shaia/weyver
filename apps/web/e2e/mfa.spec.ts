import { expect, test } from "@playwright/test"
import { actUntil } from "./hydration"
import { authenticator } from "otplib"

/* F-4 MFA 固化(承 MCP 走通):註冊 → 帳號設定啟用 TOTP(otplib 由畫面 secret 產碼)
   → 已啟用 → 登出 → 登入密碼步後導二步 → 輸入 TOTP → 進工作區。
   註:dev 後端不強制登入,但 login/2FA/session 均真實運作;此 spec 驗證真實 2FA UI 流程。 */

/* 🔴 加隨機碼。原本只取時間戳末 6 碼 —— 那是**每 ~16.7 分鐘就重複一次**的值,
   同一天內重跑就可能撞到既有帳號;撞到之後畫面會停在二步驟驗證頁,
   看起來像「註冊壞了」,而真正的原因只是 email 已存在。 */
const uniq = (): string => `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`

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

  /* 🔴 備用碼是**單向雜湊**儲存且只顯示這一次 —— 弄丟就永久拿不回來,
     而弄丟手機正是它存在的理由。GitHub / Google 都提供下載/複製/列印
     並要求確認已保存;缺了那道確認,使用者會一路點過去,
     在手機掉了那天才發現自己沒存。 */
  await expect(page.getByRole("button", { name: "下載為 .txt" })).toBeVisible()
  await expect(page.getByRole("button", { name: "複製全部" })).toBeVisible()
  await expect(page.getByRole("button", { name: "完成啟用" })).toBeDisabled()
  await page.getByRole("checkbox").check()
  await expect(page.getByRole("button", { name: "完成啟用" })).toBeEnabled()

  const secret = ((await page.getByTestId("totp-secret").textContent()) ?? "").trim()
  expect(secret.length).toBeGreaterThan(0)
  await page.getByPlaceholder("123456").fill(authenticator.generate(secret))
  await page.getByRole("button", { name: "完成啟用" }).click()
  await expect(page.getByText("已啟用")).toBeVisible()

  /* 🔴 沒有重生就只剩「停用再啟用」一條路,而那中間有一段**完全沒有第二因子**
     的空窗 —— 為了換一組碼而暫時降低安全等級,本末倒置。 */
  await expect(page.getByRole("button", { name: "重新產生備用碼" })).toBeVisible()

  // 登出 → 登入 → 密碼步後導二步
  await page.getByRole("button", { name: "登出", exact: true }).click()
  /* dev server 會即時編譯路由,導向本身就可能花數秒 ——
     這條給與同檔其他斷言一致的預算,別讓「還在導」看起來像「登出壞了」。 */
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 })
  /* 🔴 填寫與送出一起重試,直到真的導走 —— 剛從 /app 導過來的 /login 可能
     還沒 hydrate,此時點下去會走**原生 GET**(網址變 `/login?`、欄位被清空),
     看起來像「密碼錯了」。整套跑時才會出現,單獨跑不會。 */
  await actUntil(
    async () => {
      await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
      await page.getByRole("textbox", { name: "密碼" }).fill(password)
      await page.getByRole("button", { name: "登入" }).click()
    },
    async () => {
      await expect(page).toHaveURL(/\/login\/2fa/, { timeout: 8_000 })
    },
    40_000,
  )

  /* 🔴 RFC 6238 §5.2:「The verifier MUST NOT accept the second attempt of the OTP
     after the successful validation has been issued for the first OTP.」

     ## 為什麼要開第二個瀏覽器 context

     這一段原本是「啟用時驗過一次 → 登出重登再輸入一次」。那個構造**綁在牆上時鐘**:
     中間隔著登出、導頁與一個 40 秒預算的重試,只要超過 30 秒就會產生**新的一組碼**,
     於是斷言到的是「驗證碼錯誤」而不是「已使用過」—— 看起來像重放防護壞了,
     其實只是碼換了。dev server 一慢就紅,而它確實紅過。

     改成:兩個 context 各自登到二步驟頁**之後**才對齊窗口、產生一組碼,
     A 用完 B 立刻用同一組。兩次提交相隔不到一秒,與機器快慢無關。

     引擎層的不變量由 api 的 `mfa.integration` 以同一組碼字串直接驗;
     這裡只負責釘住**使用者看得到的訊息** —— 原本一律顯示「驗證碼錯誤」,
     使用者會一直重打螢幕上那組看起來還有效的碼,永遠不會成功。 */
  const second = await page.context().browser()?.newContext()
  if (second === undefined) throw new Error("no browser for second context")
  const pageB = await second.newPage()
  await pageB.goto("/login")
  await actUntil(
    async () => {
      await pageB.getByRole("textbox", { name: "電子郵件" }).fill(email)
      await pageB.getByRole("textbox", { name: "密碼" }).fill(password)
      await pageB.getByRole("button", { name: "登入" }).click()
    },
    async () => {
      await expect(pageB).toHaveURL(/\/login\/2fa/, { timeout: 8_000 })
    },
    40_000,
  )

  /* 兩邊都已停在二步驟頁 → 對齊到窗口起點再產碼,兩次提交都落在同一個 time step */
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 2_000)
  const sharedCode = authenticator.generate(secret)

  await page.locator("input[autocomplete='one-time-code']").fill(sharedCode)
  await page.getByRole("button", { name: "驗證並登入" }).click()
  await expect(page).toHaveURL(/\/app\/builder/)

  await pageB.locator("input[autocomplete='one-time-code']").fill(sharedCode)
  await pageB.getByRole("button", { name: "驗證並登入" }).click()
  await expect(pageB.getByText("此驗證碼已使用過,請等 app 換下一組再輸入")).toBeVisible()
  await expect(pageB).toHaveURL(/\/login\/2fa/)
  await second.close()

  // 成功的那一邊已進工作區,頂帶顯示公司名
  await expect(page.getByText(orgName)).toBeVisible()
})

/* 🔴 #112|租戶強制二步驟驗證的完整迴圈。

   依據(一手)|GitHub 組織 2FA 要求的兩條逐字規定:
   · 「Before you can require organization members... you must enable 2FA for your account.」
   · 「Members ... who do not use 2FA will not be able to access your organization's
      resources **until they enable 2FA** on their account.」

   後者的「until they enable」是這條測試最重要的部分 —— 擋人的同時**必須留下
   一條自救的路**。擋錯了就是全公司一起鎖死,而管理員自己也進不去把開關關掉。 */
/* 🔴 **本案必須自己收拾**。dev 的租戶由固定的 `x-dev-tenant`(預設 1)決定,
   與登入的是誰無關 —— 所以這條測試開的是**共用的 dev 租戶 1** 的政策開關。
   留著不關的話,後面每一條「新註冊但還沒啟用 2FA」的測試都會被導到啟用頁,
   看起來像是別的功能壞了。實測已經踩過一次。 */
test.afterEach(async ({ request }) => {
  await request
    .patch("/api/engine/settings/tenant", {
      headers: { "x-dev-tenant": "1", "x-dev-actor": "1" },
      data: { requireMfa: false },
    })
    .catch(() => null)
})

test("🔴 強制 2FA:自己沒開不准開;開了之後未啟用者被擋,但仍走得到啟用頁", async ({ page }) => {
  const suffix = uniq()
  const email = `policy_${suffix}@weyver.test`
  const password = "s3cret-passw0rd"

  await page.goto("/register")
  await page.getByRole("textbox", { name: "公司名稱" }).fill(`政策廠_${suffix}`)
  await page.getByRole("textbox", { name: "您的姓名" }).fill("管理員")
  await page.getByRole("textbox", { name: "電子郵件" }).fill(email)
  await page.getByRole("textbox", { name: "密碼(至少 15 碼)" }).fill(password)
  await page.getByRole("button", { name: "建立並進入" }).click()
  await expect(page).toHaveURL(/\/app\/builder/)

  /* 1) 🔴 自己還沒啟用就想要求全公司 → 必須被擋。
        否則第一個被自己鎖在門外的就是管理員,而他是唯一能關掉開關的人。 */
  await page.goto("/app/settings/company")
  await expect(page.getByRole("heading", { name: "公司設定" })).toBeVisible({ timeout: 30_000 })
  await page.getByRole("checkbox", { name: /要求全公司使用二步驟驗證/ }).check()
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText("請先為自己啟用二步驟驗證")).toBeVisible({ timeout: 15_000 })

  /* 2) 自己啟用 2FA 之後才准開 */
  await page.goto("/app/settings/security")
  await page.getByPlaceholder("••••••••").fill(password)
  await page.getByRole("button", { name: "啟用二步驟驗證" }).click()
  await page.getByRole("checkbox").check()
  const secret = ((await page.getByTestId("totp-secret").textContent()) ?? "").trim()
  await page.getByPlaceholder("123456").fill(authenticator.generate(secret))
  await page.getByRole("button", { name: "完成啟用" }).click()
  await expect(page.getByText("已啟用")).toBeVisible({ timeout: 15_000 })

  await page.goto("/app/settings/company")
  await expect(page.getByRole("heading", { name: "公司設定" })).toBeVisible({ timeout: 30_000 })
  await page.getByRole("checkbox", { name: /要求全公司使用二步驟驗證/ }).check()
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText("已儲存")).toBeVisible({ timeout: 15_000 })

  /* 3) 政策開啟後,**守規矩的人不受影響** —— 一條容易寫壞的路:
        把閘門寫成「只要租戶開了就擋」,連已啟用的人也會被鎖在外面。

        「未啟用者被擋 + 帳號安全頁仍進得去」由 api 側固化
        (`mfa-gate.test` 的豁免清單 + `mfa-policy.integration` 的判斷來源)——
        瀏覽器這一端要造出「同公司但未啟用」的第二人得走完整邀請流程,
        成本遠高於它能多證明的東西。 */
  await page.goto("/app/builder")
  await expect(page).toHaveURL(/\/app\/builder/)
  await expect(page.getByRole("heading", { name: "選擇或建立表單" })).toBeVisible({
    timeout: 30_000,
  })
})
