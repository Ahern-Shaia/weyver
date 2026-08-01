import { expect, test } from "@playwright/test"

/* G-1 整合設定 UI 固化。對 dev api + 真 PG。

   固化的是**三件瀏覽器實走才發現 / 才驗得到的事**:
   1. SSRF 被擋時要說得出理由(原本落到 500「internal error」)
   2. 秘鑰只顯示一次,且畫面要明說
   3. 未驗證端點的狀態要看得見(否則使用者以為壞掉) */

test("🔴 內網位址被擋,且錯誤訊息說得出原因", async ({ page }) => {
  await page.goto("/app/settings/integrations")
  const input = page.getByLabel("Webhook 網址")
  await expect(input).toBeVisible({ timeout: 30_000 })

  await input.fill("https://169.254.169.254/latest/meta-data/")
  await input.press("Enter")

  // 不是「internal error」—— 要指出踩到什麼
  await expect(page.getByText(/目標位址不被允許/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/169\.254\.169\.254/)).toBeVisible()
})

test("拒 http 與 URL 內嵌帳密", async ({ page }) => {
  await page.goto("/app/settings/integrations")
  const input = page.getByLabel("Webhook 網址")
  await expect(input).toBeVisible({ timeout: 30_000 })

  await input.fill("http://example.com/hook")
  await input.press("Enter")
  await expect(page.getByText(/只允許 https/)).toBeVisible({ timeout: 15_000 })

  await input.fill("https://user:pw@example.com/hook")
  await input.press("Enter")
  await expect(page.getByText(/不得內嵌帳密/)).toBeVisible({ timeout: 15_000 })
})

test("🔴 建端點:秘鑰只顯示一次,且端點標示待驗證", async ({ page }) => {
  const stamp = String(Date.now()).slice(-6)
  /* 🔴 用**路徑**帶 stamp 而非子網域:SSRF 防護會拒絕無法解析的主機名
     (解析不到就無法驗證 IP,也就無法 pin —— fail-closed 是正確行為),
     隨機子網域不存在於 DNS,會被正當地擋下。 */
  const url = `https://example.com/e2e-hook-${stamp}`
  await page.goto("/app/settings/integrations")
  const input = page.getByLabel("Webhook 網址")
  await expect(input).toBeVisible({ timeout: 30_000 })

  await input.fill(url)
  await input.press("Enter")

  await expect(page.getByText(/只顯示這一次/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/whsec_/)).toBeVisible()

  const row = page.getByRole("listitem").filter({ hasText: url })
  await expect(row).toBeVisible()
  // 未通過挑戰的端點收不到投遞 —— 狀態必須看得見
  await expect(row.getByText("待驗證")).toBeVisible()

  // 重新載入後秘鑰不再出現(只在建立當下回傳一次)
  await page.reload()
  await expect(page.getByText(/whsec_/)).toBeHidden()
  await expect(page.getByRole("listitem").filter({ hasText: url })).toBeVisible()
})

/* 🔴 自己收拾。金鑰清單有上限,而每跑一次 e2e 就多一把 —— 累積到一定數量後,
   新建的那把會落在清單之外,`filter({hasText: name})` 於是配到「只顯示這一次」
   的揭露面板(它也含名稱、但顯示的是完整金鑰不是前綴)→ 斷言失敗。
   表象是「金鑰功能壞了」,實際是 dev DB 累積。實測清掉 41 把舊金鑰即恢復。 */
test.beforeEach(async ({ request }) => {
  const res = await request.get("/api/engine/integrations/api-keys", {
    headers: { "x-dev-tenant": "1", "x-dev-actor": "1" },
  })
  const keys = (await res.json().catch(() => [])) as { id: number; name: string }[]
  for (const k of Array.isArray(keys) ? keys : []) {
    if (k.name?.startsWith("E2E")) {
      await request
        .delete(`/api/engine/integrations/api-keys/${String(k.id)}`, {
          headers: { "x-dev-tenant": "1", "x-dev-actor": "1" },
        })
        .catch(() => null)
    }
  }
})

test("簽發 API 金鑰:明文只出現一次,清單只留前綴", async ({ page }) => {
  const stamp = String(Date.now()).slice(-6)
  const name = `E2E金鑰_${stamp}`
  await page.goto("/app/settings/integrations")
  const input = page.getByLabel("金鑰名稱")
  await expect(input).toBeVisible({ timeout: 30_000 })

  await input.fill(name)
  await input.press("Enter")

  await expect(page.getByText(/只顯示這一次/)).toBeVisible({ timeout: 15_000 })
  const row = page.getByRole("listitem").filter({ hasText: name })
  await expect(row).toBeVisible()
  await expect(row.getByText(/wvk_\w+…/)).toBeVisible()

  await page.reload()
  const after = page.getByRole("listitem").filter({ hasText: name })
  await expect(after).toBeVisible()
  // 重新載入後只看得到前綴,看不到完整金鑰
  await expect(page.getByText(/只顯示這一次/)).toBeHidden()
})
