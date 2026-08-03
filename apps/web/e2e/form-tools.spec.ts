import { expect, test } from "@playwright/test"

/* 🔴 R1·IA-1|表單層「工具」聚合入口(docs/33)。

   釘住的是**IA 而非功能** —— 這批動的三件事都已經 SHIPPED,
   問題是使用者找不到:匯出在檢視工具列、標籤在設計器、公開設定在設定中心。
   而「找不到」與「沒有」對客戶而言沒有差別。

   最容易在日後被改壞的一條是**深連要帶著表單** ——
   少了它就退回「離開表單 → 進設定 → 把同一張表再選一次」,
   而那正是這次要修掉的症狀,且退化時畫面看起來完全正常。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }

async function makeForm(request: import("@playwright/test").APIRequestContext): Promise<{
  id: number
  name: string
}> {
  const name = `工具選單_${String(Date.now()).slice(-6)}`
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name, fields: [{ name: "品名", type: "text" }] },
  })
  return { id: ((await res.json()) as { id: number }).id, name }
}

test("表單層有單一「工具」聚合入口,且依動作對象分組", async ({ page, request }) => {
  const form = await makeForm(request)
  await page.goto(`/app/forms/${String(form.id)}`)
  await page.getByRole("button", { name: "工具" }).click()

  const menu = page.getByRole("menu", { name: "表單工具" })
  await expect(menu).toBeVisible()
  /* 不照抄 Ragic 六組(我們只有 11 項,硬分六組會出現只有一項的組) */
  await expect(menu.getByText("資料", { exact: true })).toBeVisible()
  await expect(menu.getByText("連外", { exact: true })).toBeVisible()
  /* 這張表沒有標籤 → 「產出」組整組不該出現,而不是出現一個空標題 */
  await expect(menu.getByText("產出", { exact: true })).toHaveCount(0)
})

test("🔴 深連必須帶著表單 —— 否則退回「進設定再選一次同一張表」", async ({ page, request }) => {
  const form = await makeForm(request)
  await page.goto(`/app/forms/${String(form.id)}`)
  await page.getByRole("button", { name: "工具" }).click()
  await page.getByRole("menuitem", { name: "公開表單設定" }).click()

  await expect(page).toHaveURL(new RegExp(`/app/settings/public-forms\\?form=${String(form.id)}`))
  /* 關鍵斷言:到站之後表單**已經選好了**,不是又回到「選擇表單」 */
  await expect(page.getByLabel("來源表單")).toHaveValue(String(form.id))
})

test("🔴 通知設定的深連同樣要預選(表單層那一半)", async ({ page, request }) => {
  const form = await makeForm(request)
  await page.goto(`/app/settings/notifications?form=${String(form.id)}`)
  await expect(page.getByLabel("選擇表單")).toHaveValue(String(form.id))
})

test("匯入資料改由工具選單進入(原本是散在標題列的單顆按鈕)", async ({ page, request }) => {
  const form = await makeForm(request)
  await page.goto(`/app/forms/${String(form.id)}`)
  /* 標題列不該再有裸露的匯入按鈕 —— 聚合的意義就在於只有一個入口 */
  await expect(page.getByRole("button", { name: "匯入資料" })).toHaveCount(0)

  await page.getByRole("button", { name: "工具" }).click()
  await page.getByRole("menuitem", { name: "匯入資料" }).click()
  await expect(page.getByText(/匯入|上傳/).first()).toBeVisible()
})
