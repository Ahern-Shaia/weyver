import { expect, test } from "@playwright/test"

/* golden path 固化(= Gate P0-1 UI 路徑):建表 → 發布 ready → 加欄 →
   填單存檔(autoNumber)→ 資料檢視 → 子表 header+lines。
   dev DB 有狀態 → 表單名帶唯一後綴避免 (tenant,name) 撞名,可重跑。 */

const uniq = () => Date.now().toString().slice(-6)

test("建表 → 加欄 → 填單 → 檢視 → 子表(單一 golden path)", async ({ page }) => {
  const formName = `E2E採購單_${uniq()}`
  const childName = `E2E明細_${uniq()}`

  await page.goto("/app/builder")

  // 1) 新建表單
  await page.getByRole("button", { name: "+ 新增" }).click()
  await page.getByRole("textbox", { name: "表單名稱" }).fill(formName)
  await page.getByRole("button", { name: "№ 自動編號" }).click()
  await page.getByRole("button", { name: "A 單行文字" }).click()
  await page.getByRole("button", { name: "$ 金額" }).click()

  // 欄位名:單號 / 供應商(必填)/ 金額(每列第一個 input 為欄名)
  const rows = page.locator("section li")
  await rows.nth(0).locator("input").first().fill("單號")
  await rows.nth(1).locator("input").first().fill("供應商")
  await rows.nth(2).locator("input").first().fill("金額")
  await rows.nth(1).getByRole("checkbox").check() // 供應商必填

  await page.getByRole("button", { name: "發布表單" }).click()

  // 2) 發布後進編輯模式,ready + 3 欄
  await expect(page.getByRole("heading", { name: formName })).toBeVisible()
  await expect(page.getByText("ready")).toBeVisible()
  await expect(page.getByText(/v1 · 3 欄/)).toBeVisible()

  // 3) 加一個日期欄「交期」
  await page.getByRole("button", { name: "◷ 日期", exact: true }).click()
  await page.getByRole("textbox", { name: "欄位名稱" }).fill("交期")
  await page.getByRole("button", { name: "加入", exact: true }).click()
  await expect(page.getByText(/v2 · 4 欄/)).toBeVisible()

  // 4) 填單
  await page.getByRole("tab", { name: "填單" }).click()
  await expect(page.getByText("儲存後自動產生")).toBeVisible()
  await page.getByRole("textbox").first().fill("鑫豐農產品") // 供應商(單號唯讀)
  await page.getByRole("textbox", { name: "0.0000" }).fill("128400.0000")
  await page.getByRole("button", { name: "儲存" }).click()

  // autoNumber 回顯
  await expect(page.getByText(/已儲存:/)).toBeVisible()

  // 5) 資料檢視:記錄出現、金額字串、供應商
  await page.getByRole("tab", { name: "資料" }).click()
  const row = page.getByRole("row").filter({ hasText: "鑫豐農產品" }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText("128400.0000")

  // 6) 子表:回設計 → 加子表
  await page.getByRole("tab", { name: "設計" }).click()
  await page.getByRole("button", { name: "＋ 加子表" }).click()
  await page.getByRole("textbox", { name: "表單名稱" }).fill(childName)
  await page.getByRole("button", { name: "A 單行文字" }).click()
  await page.getByRole("button", { name: "# 數值" }).click()
  const childRows = page.locator("section li")
  await childRows.nth(0).locator("input").first().fill("品項")
  await childRows.nth(1).locator("input").first().fill("數量")
  await page.getByRole("button", { name: "發布表單" }).click()

  // 回父表單 → 填單 → 應出現明細編輯器
  await page.getByRole("button", { name: new RegExp(formName) }).click()
  await page.getByRole("tab", { name: "填單" }).click()
  await page.getByRole("textbox").first().fill("正大食材")
  await page.getByRole("button", { name: "＋ 加一行" }).click()
  const lineRow = page.locator("tbody tr").first()
  await lineRow.getByRole("textbox").nth(0).fill("冷凍雞腿")
  await lineRow.getByRole("textbox").nth(1).fill("10")
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText(/已儲存:/)).toBeVisible()
})
