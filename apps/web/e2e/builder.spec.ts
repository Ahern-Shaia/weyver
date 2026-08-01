import { expect, test } from "@playwright/test"

/* golden path 固化(= Gate P0-1 UI 路徑):建表 → 加欄 → 填單存檔(autoNumber)
   → 資料檢視 → 子表 header+lines。
   dev DB 有狀態 → 表單名帶唯一後綴避免 (tenant,name) 撞名,可重跑。

   🔴 **這是全庫唯一一條「透過 UI 建立表單」的 spec,刻意如此。**

   Cypress 官方對這個取捨的小節標題逐字是「Fully test the login flow -- but only once!」
   —— 關鍵流程要有一條端到端走 UI 的覆蓋,但**其餘 spec 的前置資料一律走 API**
   (Playwright 官方 api-testing:「Prepare server side state before visiting the web
   application in a test.」)。

   本專案的實證(#126):15 個 e2e 中只有 2 個用 UI 建表,而設計器改版時
   **就是那 2 個斷在「建表」這個前置步驟**,不是斷在它們真正要測的東西;
   另外 13 個用 API 建表的完全不受影響。Google Testing Blog(Wacker 2015)
   對這個模式的描述逐字是「Signing in to the service is broken. Almost all tests
   sign in a user, so almost all tests failed.」與「Many smaller bugs were hidden
   behind bigger bugs.」—— 我們這次正是後者:兩個真的 bug 藏在紅燈測試後面。 */

const uniq = () => Date.now().toString().slice(-6)

test("建表 → 加欄 → 填單 → 檢視 → 子表(單一 golden path)", async ({ page }) => {
  const formName = `E2E採購單_${uniq()}`
  const childName = `E2E明細_${uniq()}`

  await page.goto("/app/builder")

  /* 1) 新建表單 —— R1·UP-3 之後,建立對話框只收表單名,
        欄位型別的選擇已移進設計器(此處原本點型別按鈕,故 #126 前一直紅)。 */
  await page.getByRole("button", { name: "+ 新增" }).click()
  await page.getByRole("textbox", { name: "表單名稱" }).fill(formName)
  await page.getByRole("button", { name: "建立並開始設計" }).click()
  await expect(page.getByRole("heading", { name: formName })).toBeVisible()
  await expect(page.getByText("ready")).toBeVisible()

  // 2) 設計器加欄:單號(autoNumber)/ 供應商(必填)/ 金額
  /* 🔴 每加一欄都等欄數更新才進下一步。加欄會讓設計器整個重繪,
     不等就會在重繪中途點下一顆型別按鈕、面板不開(整套跑時穩定重現,單跑時不會)。
     這正是「斷言狀態、不要靠下一個 locator 的 auto-wait 兜」的理由。 */
  let count = 0
  const addField = async (type: string, name: string, required = false): Promise<void> => {
    await page.getByRole("button", { name: type, exact: true }).click()
    await page.getByRole("textbox", { name: "欄位名稱" }).fill(name)
    if (required) await page.getByRole("checkbox", { name: "必填" }).check()
    await page.getByRole("button", { name: "加入", exact: true }).click()
    count += 1
    await expect(page.getByText(new RegExp(`· ${String(count)} 欄`))).toBeVisible()
  }
  await addField("自動編號", "單號")
  await addField("單行文字", "供應商", true)
  await addField("金額", "金額")

  // 3) 填單:autoNumber 唯讀由後端產號
  await page.getByRole("tab", { name: "填單" }).click()
  await expect(page.getByText("儲存後自動產生")).toBeVisible()
  await page.getByRole("textbox").first().fill("鑫豐農產品") // 供應商(單號唯讀)
  await page.getByRole("textbox", { name: "0.0000" }).fill("128400.0000")
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText(/已儲存:/)).toBeVisible()

  // 4) 資料檢視:記錄出現、金額字串、供應商
  await page.getByRole("tab", { name: "資料" }).click()
  const row = page.getByRole("row").filter({ hasText: "鑫豐農產品" }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText("128400.0000")

  // 5) 子表:回設計 → 加子表 → 於子表設計器加欄
  await page.getByRole("tab", { name: "設計" }).click()
  await page.getByRole("button", { name: "＋ 加子表" }).click()
  await page.getByRole("textbox", { name: "表單名稱" }).fill(childName)
  await page.getByRole("button", { name: "建立並開始設計" }).click()
  await expect(page.getByRole("heading", { name: childName })).toBeVisible()
  count = 0 // 子表是另一張新表,欄數從 0 起算
  await addField("單行文字", "品項")
  await addField("數值", "數量")

  // 6) 回父表單 → 填單 → 明細編輯器可加行並隨 header 一起存
  await page.getByRole("button", { name: new RegExp(formName) }).click()
  await page.getByRole("tab", { name: "填單" }).click()
  await page.getByRole("textbox").first().fill("正大食材")
  await page.getByRole("button", { name: "加一行" }).click()
  const lineRow = page.locator("tbody tr").first()
  await lineRow.getByRole("textbox").nth(0).fill("冷凍雞腿")
  await lineRow.getByRole("textbox").nth(1).fill("10")
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText(/已儲存:/)).toBeVisible()
})
