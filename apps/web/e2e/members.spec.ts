import { expect, test } from "@playwright/test"

/* R1·A-1 M2|使用者管理。

   後端規格(15 字 / 一次性 / 逐成員停權)由 api 的 `members.integration.test.ts`
   對真 PG 固化;本檔只固化**瀏覽器這一端**,而且是三條**研究直接推導出來的介面性質**:

   1. 沒有「設定密碼」欄位 —— ASVS §V6.4.6 反對管理員知道使用者密碼。
      這條用「畫面上不存在那個輸入框」守,而不是驗證錯誤訊息。
   2. 初始密碼 15 字且**明講只顯示一次** —— 少了這句,管理員會以為之後查得到。
   3. 沒有刪除 —— Ragic 官方:「不建議直接刪除使用者,避免失去使用者的資料」。

   ⚠️ 成員管理需要**已綁 org 的租戶**(Better Auth 的 `member` 表以 org 為界)。
   dev 的租戶解析走 `x-dev-tenant` 且**刻意不觸 session**(OQ-AUTH-7),
   故此處註冊新公司也不會改變後續請求的租戶 —— 改由 `global-setup` 幫 dev 租戶 1
   綁一個 org,那同時修好「dev 環境成員功能完全不可用」這件事。 */

const uniq = (): string => Date.now().toString().slice(-6)

test("🔴 新增成員:系統產生 15 字初始密碼,且明講只顯示一次", async ({ page }) => {
  await page.goto("/app/settings/members")
  await expect(page.getByRole("heading", { name: "成員" })).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "新增成員" }).click()

  /* 🔴 ASVS §V6.4.6:管理員不得選擇使用者的密碼 —— 畫面上根本沒有那個欄位。
     這比「送了密碼會被拒」更強:不存在的入口不會被誤用,也不需要維護檢核。 */
  await expect(page.getByLabel("密碼")).toHaveCount(0)
  await expect(page.getByText("管理員無法自行指定密碼")).toBeVisible()

  await page.getByLabel("Email").fill(`hire_${uniq()}@weyver.test`)
  await page.getByLabel("姓名").fill("新同事")
  await page.getByRole("button", { name: "建立並產生密碼" }).click()

  // 明講只顯示一次 —— 少了這句,管理員會以為之後查得到
  await expect(page.getByText("這組密碼只顯示這一次")).toBeVisible({ timeout: 30_000 })

  /* 15 字為 NIST 63B-4 §3.1.1.2 的單因子門檻(rev 3 的 6 字豁免已被刪除)。
     一併確認不含易混淆字 —— 15 字唸不出來,但一旦有人手抄,那幾個字元就是客服電話。 */
  const shown = (await page.locator("code").first().textContent()) ?? ""
  expect(shown.trim()).toHaveLength(15)
  expect(shown).not.toMatch(/[0O1lI]/)
})

test("🔴 新成員標示為「未啟用」,且離職走停用不是刪除", async ({ page }) => {
  await page.goto("/app/settings/members")
  await expect(page.getByRole("heading", { name: "成員" })).toBeVisible({ timeout: 30_000 })

  /* 名字帶唯一後綴 —— dev DB 有狀態,同名列會累積,`filter({hasText})` 會撞到多列 */
  const who = `待啟用同事_${uniq()}`
  await page.getByRole("button", { name: "新增成員" }).click()
  await page.getByLabel("Email").fill(`hire_${uniq()}@weyver.test`)
  await page.getByLabel("姓名").fill(who)
  await page.getByRole("button", { name: "建立並產生密碼" }).click()
  await expect(page.getByText("這組密碼只顯示這一次")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "我已經複製好了" }).click()

  /* 「未啟用」= 已建帳號但對方還沒用初始密碼登入過。
     Ragic 的成員頁也有這一欄(密碼「已設 / 未設」)—— 少了它,
     管理員不知道對方到底進來了沒有。 */
  const row = page.getByRole("listitem").filter({ hasText: who })
  await expect(row.getByText("未啟用")).toBeVisible()

  /* 🔴 承 Ragic 官方「不建議直接刪除使用者,避免失去使用者的資料」——
     記錄的建立者 / 簽核對象都指向 actor,刪掉會讓歷史單據失去可解釋性。 */
  await expect(row.getByRole("button", { name: "刪除" })).toHaveCount(0)

  await row.getByRole("button", { name: "停用" }).click()
  await expect(row.getByText("已停用")).toBeVisible()
  await expect(row.getByRole("button", { name: "復用" })).toBeVisible()
})
