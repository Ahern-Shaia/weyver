import { expect, test } from "@playwright/test"

/* 🔴 R1·A-1 M4|通知通道連接。

   加密與 RLS 由 api 的 `notification-channels.integration.test` 對真 PG 固化;
   本檔固化**瀏覽器這一端**的三條性質,每條都有理由:

   1. **憑證欄位永遠是空的,而且畫面要講「留白 = 保留」** ——
      Grafana `secureJsonFields` 模式下後端不回值,若不講,使用者會以為自己剛清空了它。
   2. **非官方網域當場被擋**,而不是存進去以後才在發送時失敗。
   3. **已設定但沒測過 ≠ 可用** —— 顯示成「已連接」會讓人以為通知送得出去。

   ⚠️ 本檔**不註冊也不登入**(走 dev 租戶),不花登入額度 —— 見 global-setup 的說明。 */

test("🔴 通道連接:憑證不回顯 / 非官方網域被擋 / 未測試不算已連接", async ({ page }) => {
  await page.goto("/app/settings/channels")
  await expect(page.getByRole("heading", { name: "通知通道" })).toBeVisible({ timeout: 30_000 })

  const discord = page.getByRole("listitem").filter({ hasText: "Discord" })
  /* ⚠️ dev DB 有狀態:前一輪跑過之後這顆按鈕會變成「更新」。
     測試不該假設乾淨的資料庫 —— 兩種標籤都要接得住。 */
  await discord.getByRole("button", { name: /^(連接|更新)$/ }).click()

  /* 🔴 (2) 非官方網域必須在**儲存當下**就被擋 —— 讓一個指向內網的網址先躺進 DB,
     任何未來新增的發送路徑都可能漏掉那道檢查。 */
  await discord.getByLabel("Webhook URL").fill("https://evil.example/hook")
  await discord.getByRole("button", { name: "儲存" }).click()
  await expect(discord.getByText(/官方網域/)).toBeVisible({ timeout: 15_000 })

  // 官方網域可存
  await discord
    .getByLabel("Webhook URL")
    .fill("https://discord.com/api/webhooks/1/e2e-secret-token")
  await discord.getByRole("button", { name: "儲存" }).click()

  /* 🔴 (3) 存了不等於可用:沒測試成功過就不能顯示「已連接」。
     憑證一改就會把 verifiedAt 歸零,所以無論前一輪是什麼狀態,這裡都該是「尚未測試」。 */
  await expect(discord.getByText("已設定,尚未測試")).toBeVisible({ timeout: 15_000 })

  /* 🔴 (1) 再打開時輸入框是空的,且畫面明講「留白 = 保留」 */
  await discord.getByRole("button", { name: "更新" }).click()
  await expect(discord.getByLabel("Webhook URL")).toHaveValue("")
  await expect(discord.getByText(/留白送出即保留原值/)).toBeVisible()

  /* 🔴 憑證不得出現在頁面任何角落(含 DOM 屬性) */
  expect(await page.content()).not.toContain("e2e-secret-token")
})
