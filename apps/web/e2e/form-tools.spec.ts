import { expect, test } from "@playwright/test"

/* 🔴 R1·IA-1|表單層「工具」聚合入口(docs/33)。

   釘住的是**IA 而非功能** —— 這批動的三件事都已經 SHIPPED,
   問題是使用者找不到:匯出在檢視工具列、標籤在設計器、公開設定在設定中心。
   而「找不到」與「沒有」對客戶而言沒有差別。

   ✅ **第二階段(2026-08-04)**:面板本身已搬進表單層,不再深連設定中心。
   最容易在日後被改壞的兩條:
   (1) 面板要**開在表單上**(退回深連時畫面看起來完全正常,只是又離開了表單);
   (2) 兩個入口的**閘門不同** —— 公開表單是租戶級安全決定(admin),
       此表單的通知是個人訂閱(不設閘門)。把它們綁在同一個布林上是第一階段犯過的錯。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }

async function makeForm(request: import("@playwright/test").APIRequestContext): Promise<{
  id: number
  name: string
}> {
  const name = `工具選單_${String(Date.now()).slice(-6)}`
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    /* autoNumber 是**一律不得公開**的型別 —— 留著它,挑選器的過濾才測得到 */
    data: {
      name,
      fields: [
        { name: "品名", type: "text" },
        { name: "單號", type: "autoNumber" },
      ],
    },
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

test("🔴 公開表單設定開在表單上,不再跳去設定中心", async ({ page, request }) => {
  const form = await makeForm(request)
  await page.goto(`/app/forms/${String(form.id)}`)
  await page.getByRole("button", { name: "工具" }).click()
  await page.getByRole("menuitem", { name: "公開表單設定" }).click()

  /* 關鍵斷言:**URL 沒有離開這張表單**。退回深連時面板長得一模一樣,
     差別只在使用者被帶走了 —— 光看畫面看不出來,所以斷言必須是網址。 */
  await expect(page).toHaveURL(new RegExp(`/app/forms/${String(form.id)}`))
  await expect(page.getByRole("heading", { name: `公開表單 · ${form.name}` })).toBeVisible()
  /* 面板裡不該再出現「選擇表單」—— 那個下拉正是這次要修掉的症狀 */
  await expect(page.getByLabel("來源表單")).toHaveCount(0)

  /* 🔴 挑選器只列可公開的型別。挑得到但一定被後端拒絕的欄位,
     等於把失敗留到按下按鈕之後 —— 而少列了東西必須說出來,不能靜默省略。 */
  await expect(page.getByRole("checkbox", { name: /品名/ })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: /單號/ })).toHaveCount(0)
  await expect(page.getByText("個欄位不能公開", { exact: false })).toBeVisible()
})

test("🔴 此表單的通知同樣開在表單上,且**不與公開表單共用閘門**", async ({ page, request }) => {
  const form = await makeForm(request)
  await page.goto(`/app/forms/${String(form.id)}`)
  await page.getByRole("button", { name: "工具" }).click()
  await page.getByRole("menuitem", { name: "此表單的通知" }).click()

  await expect(page).toHaveURL(new RegExp(`/app/forms/${String(form.id)}`))
  await expect(page.getByRole("heading", { name: `通知 · ${form.name}` })).toBeVisible()
  /* 個人訂閱:設了要能回得去。沒有「恢復繼承」時 scope='form' 是單向的 */
  await expect(page.getByRole("radiogroup", { name: "通知層級" })).toBeVisible()
  await page.getByRole("radio", { name: /全部/ }).click()
  await expect(page.getByRole("button", { name: "恢復繼承" })).toBeVisible()
  await page.getByRole("button", { name: "恢復繼承" }).click()
  await expect(page.getByText("目前繼承上層設定", { exact: false })).toBeVisible()
})

test("設定中心的通知頁改為逐表單列出,不再是「選一張表單」的下拉", async ({ page, request }) => {
  const form = await makeForm(request)
  await page.goto("/app/settings/notifications")
  await expect(page.getByLabel("選擇表單")).toHaveCount(0)
  /* 清單才做得到、下拉做不到的事:一次看到並調整多張表單的訂閱 */
  await expect(page.getByLabel(`${form.name} 的通知層級`)).toBeVisible()
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
