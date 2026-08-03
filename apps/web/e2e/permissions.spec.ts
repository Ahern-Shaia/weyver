import { expect, test } from "@playwright/test"

/* P0-4a·uplift 資源軸繼承 UI 固化:建分類 → 表單歸類 → 建角色 → 矩陣「分類分組」→
   分類授權(繼承來源)→ 表單繼承 → 建立覆寫 → 還原繼承。dev DB 有狀態 → 名帶唯一後綴可重跑。 */

const uniq = () => Date.now().toString().slice(-6)

test("資源軸繼承:分類授權 → 表單繼承 → 覆寫 → 還原繼承", async ({ page }) => {
  const cat = `E2E分類_${uniq()}`
  const role = `E2E主管_${uniq()}`

  await page.goto("/app/settings/permissions")
  // 等 hydration + 角色載入完成(避免在互動前點擊);「編輯者」為系統角色、名稱無 badge
  await expect(page.getByRole("button", { name: "編輯者", exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // 1) 展開設定 → 建分類
  await page.getByRole("button", { name: /分類與預設設定/ }).click()
  const catInput = page.getByRole("textbox", { name: "新分類名稱,Enter 建立" })
  await catInput.fill(cat)
  await catInput.press("Enter")

  // 2) 把第一張表單歸到此分類(selectOption 會等該分類 option 出現 = 建立成功)
  const firstSelect = page.locator('select[aria-label$="分類"]').first()
  const formName = (await firstSelect.getAttribute("aria-label"))?.replace(/ 分類$/, "") ?? ""
  await firstSelect.selectOption({ label: cat })

  // 收合設定(縮短頁面)
  await page.getByRole("button", { name: /分類與預設設定/ }).click()

  // 3) 建角色(建立後自動選取)
  await page.getByRole("button", { name: "新增角色" }).click()
  const roleInput = page.getByRole("textbox", { name: "角色名稱,Enter 建立" })
  await roleInput.fill(role)
  await roleInput.press("Enter")
  await expect(page.getByRole("heading", { name: role })).toBeVisible()

  // 4) 矩陣:此分類的「分類授權」列存在(分類分組成立)
  const catRow = page.getByRole("row").filter({ hasText: cat }).filter({ hasText: "分類授權" })
  await expect(catRow).toBeVisible()

  // 5) 授權「檢視」(第 1 cell=名稱,第 2 cell=檢視)
  await catRow.getByRole("cell").nth(1).getByRole("button").click()

  // 6) 該分類下的表單列出現「繼承」標(繼承下傳)
  const formRow = page.getByRole("row").filter({ hasText: `└ ${formName}` })
  await expect(formRow.getByText("繼承", { exact: true })).toBeVisible()

  // 7) 點表單「編輯」格 → 建立覆寫(出現「覆寫」+「還原繼承」)
  await formRow.getByRole("cell").nth(3).getByRole("button").click()
  await expect(formRow.getByText("覆寫", { exact: true })).toBeVisible()
  const revert = formRow.getByRole("button", { name: /還原繼承/ })
  await expect(revert).toBeVisible()

  // 8) 還原繼承 → 回「繼承」
  await revert.click()
  await expect(formRow.getByText("繼承", { exact: true })).toBeVisible()
})

/* 🔴 authz 0-bis 項 7:具名預設為主控件。

   釘住的是**名稱與內容不脫節** —— 選「編輯者」就要真的得到編輯者那組動作。
   權限畫面謊報一次,客戶就不會再信任它顯示的任何一格,
   而退化時畫面看起來完全正常(勾選框仍在、仍可點)。 */
test("權限矩陣:選具名預設一次設好整組動作,且組合不符時顯示「自訂」", async ({ page }) => {
  await page.goto("/app/settings/permissions")
  await page.getByRole("button", { name: "採購主管" }).first().click()

  /* 🔴 先鎖定「哪一列」,再從那一列取控件 —— 反過來會壞:
     `filter({ has: <帶 .first() 的定位器> })` 的內層是相對於每一列重新解析的,
     `.first()` 在此無意義,結果是**每一列都命中**(28 = 7 列 × 4)。
     矩陣只有一張表單時剛好看不出來,表單一多就整個失準。 */
  const row = page
    .locator("tbody tr")
    .filter({ has: page.getByLabel("權限預設") })
    .first()
  const picker = row.getByLabel("權限預設")
  await expect(picker).toBeVisible({ timeout: 30_000 })
  await picker.selectOption("editor")

  /* 編輯者 = view / create / edit / export;delete / approve / design 不給 */
  await expect(row.getByRole("button", { name: /已授權/ })).toHaveCount(4)

  /* 逐格再勾一個 → 不再等於任何預設 → 退回「自訂」,不做「最接近」的模糊比對 */
  await row.getByRole("button", { name: "未授權" }).first().click()
  await expect(picker).toHaveValue("__custom__")
})
