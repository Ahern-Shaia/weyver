import { expect, test } from "@playwright/test"

/* R1·workbench-uplift M4 UI 固化:Object Page 密度補強 —— 狀態章 / 金額彙總 /
   清單列 enrich / 關聯 rail(正+反向)/ inline 編輯。
   後端(users lookup 跨租戶隔離、反向關聯權限過濾)由 api integration 6 測固化。
   自建獨立表單以免依賴 dev DB 既有狀態。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "7" }
const uniq = () => Date.now().toString().slice(-6)

async function seedLinkedForms(request: import("@playwright/test").APIRequestContext): Promise<{
  supplierFormId: number
  poFormId: number
  supplierRecordId: number
}> {
  const tag = uniq()
  const supplier = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E供應商_${tag}`, fields: [{ name: "名稱", type: "text", required: true }] },
  })
  const supplierFormId = (await supplier.json()).id as number

  const po = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E採購單_${tag}`,
      fields: [
        { name: "單號", type: "text", required: true },
        { name: "狀態", type: "singleSelect", options: { choices: ["草稿", "待審", "已核准"] } },
        { name: "金額", type: "money" },
        { name: "供應商", type: "link", options: { targetFormId: supplierFormId } },
      ],
    },
  })
  const poFormId = (await po.json()).id as number

  const supplierRecord = await request.post(`/api/engine/forms/${supplierFormId}/records`, {
    headers: DEV,
    data: { values: { 名稱: "鑫豐食品" } },
  })
  const supplierRecordId = (await supplierRecord.json()).id as number

  await request.post(`/api/engine/forms/${poFormId}/records`, {
    headers: DEV,
    data: {
      values: {
        單號: `PO-${tag}`,
        狀態: "待審",
        金額: "128400.0000",
        供應商: supplierRecordId,
      },
    },
  })
  return { supplierFormId, poFormId, supplierRecordId }
}

test("Object Page:狀態章 + 金額彙總 + 清單列狀態/金額", async ({ page, request }) => {
  const { poFormId } = await seedLinkedForms(request)
  await page.goto(`/app/forms/${poFormId}?mode=record`)
  await expect(page.getByText("基本資料").first()).toBeVisible({ timeout: 30_000 })

  // 標題列狀態章(OQ-RWB-3=A:首個 singleSelect)
  await expect(page.getByRole("heading", { level: 3 })).toContainText("PO-")
  await expect(page.getByText("待審").first()).toBeVisible()

  // 金額彙總 + 左欄清單列同時帶狀態與金額(triage 訊號)
  /* 🔴 金額顯示為**格式化後**的樣子。原本這條斷言的是 `128400.0000` ——
     它釘住的是資料庫的內部表示,等於把「沒做完」寫成規格。
     docs/14 把金額列為信任訊號:千分位 + 幣別小數位(ICU 對 TWD 給 2 位)。 */
  await expect(page.getByText("128,400.00").first()).toBeVisible()
  await expect(page.getByText("128400.0000")).toHaveCount(0)
  /* 記錄清單項於 R1·UX-1 M5 改為 APG listbox 的 option(原為隱含 button role) */
  const listItem = page.getByRole("option", { name: /PO-.*待審.*128,400\.00/ })
  await expect(listItem).toBeVisible()
})

test("關聯 rail:正向「本筆引用」與反向「被引用」互為導航", async ({ page, request }) => {
  const { supplierFormId, poFormId, supplierRecordId } = await seedLinkedForms(request)

  // 採購單 → 正向:引用供應商
  await page.goto(`/app/forms/${poFormId}?mode=record`)
  await expect(page.getByRole("heading", { name: "關聯記錄" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("本筆引用")).toBeVisible()
  const outgoing = page.getByRole("link", { name: /供應商.*#/ })
  await expect(outgoing).toBeVisible()

  // 供應商 → 反向:被採購單引用
  await page.goto(`/app/forms/${supplierFormId}?mode=record&rid=${supplierRecordId}`)
  await expect(page.getByRole("heading", { name: "關聯記錄" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/被 E2E採購單_.*引用/)).toBeVisible()
  await expect(page.getByRole("link", { name: /^PO-/ })).toBeVisible()
})

test("inline 編輯:就地改狀態 → 版本遞增 + 清單與狀態章同步", async ({ page, request }) => {
  const { poFormId } = await seedLinkedForms(request)
  await page.goto(`/app/forms/${poFormId}?mode=record`)
  await expect(page.getByText("#1 · v1")).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "編輯", exact: true }).click()
  /* ⚠️ 不用整頁範圍的 `getByRole("combobox")` —— 這張表有連結欄,它的選記錄器也是 combobox。
     改用欄位的無障礙名稱(2026-08-04 補:欄位輸入原本在無障礙樹上沒有名字)。 */
  await page.getByRole("combobox", { name: "狀態" }).selectOption("已核准")
  await page.getByRole("button", { name: "儲存", exact: true }).click()

  await expect(page.getByText("已儲存")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("#1 · v2")).toBeVisible()
  // 狀態章與左欄清單同步(同一份 query cache)
  await expect(page.getByRole("option", { name: /PO-.*已核准/ })).toBeVisible()
  // 已回到檢視模式(不再有輸入框)
  await expect(page.getByRole("combobox", { name: "狀態" })).toBeHidden()
})

/* 🔴 未儲存變更防護。Fiori 逐字:「If the user has made changes in edit mode,
   show a data loss message whenever the user navigates away from the edit page
   or clicks Cancel.」原本兩條路徑都沒擋 —— 編輯到一半點別筆記錄,整筆改動靜默消失。 */
test("🔴 編輯中按取消 / 切換記錄,都必須先問過才丟", async ({ page, request }) => {
  const { poFormId } = await seedLinkedForms(request)
  /* 第二筆:用來驗「切換記錄」那條路徑 */
  await request.post(`/api/engine/forms/${poFormId}/records`, {
    headers: DEV,
    data: { values: { 單號: "PO-第二筆", 狀態: "草稿", 金額: "1.0000" } },
  })

  await page.goto(`/app/forms/${poFormId}?mode=record`)
  await expect(page.getByText("#1 · v1")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "編輯", exact: true }).click()
  await page.getByRole("combobox", { name: "狀態" }).selectOption("已核准")

  // 1) 取消 —— 拒絕捨棄則留在編輯中
  page.once("dialog", (d) => {
    expect(d.message()).toContain("未儲存")
    void d.dismiss()
  })
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "狀態" })).toBeVisible()

  // 2) 切換記錄 —— 同樣要先問;拒絕則停在原記錄且編輯中
  page.once("dialog", (d) => {
    expect(d.message()).toContain("未儲存")
    void d.dismiss()
  })
  await page.getByRole("option", { name: /PO-第二筆/ }).click()
  await expect(page.getByRole("combobox", { name: "狀態" })).toBeVisible()
  await expect(page.getByRole("heading", { level: 3 })).not.toContainText("第二筆")

  // 3) 確認捨棄才真的離開
  page.once("dialog", (d) => {
    void d.accept()
  })
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "狀態" })).toBeHidden()

  /* 🔴 改了又改回來不算 dirty —— 否則使用者會被無謂的警告訓練成無視它 */
  await page.getByRole("button", { name: "編輯", exact: true }).click()
  await page.getByRole("combobox", { name: "狀態" }).selectOption("已核准")
  await page.getByRole("combobox", { name: "狀態" }).selectOption("待審")
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "狀態" })).toBeHidden()
})

/* 🔴 #110 加了響應式斷點卻沒有任何測試釘住 —— 版面回歸在窄螢幕上看不見。
   Material 的 list-detail:窄螢幕清單與詳情各佔一畫面,選了記錄清單就讓位。 */
test("🔴 窄螢幕:清單與詳情各佔一畫面(list-detail 降級)", async ({ page, request }) => {
  const { poFormId } = await seedLinkedForms(request)
  await page.setViewportSize({ width: 480, height: 900 })
  await page.goto(`/app/forms/${poFormId}?mode=record`)
  await expect(page.getByText("基本資料").first()).toBeVisible({ timeout: 30_000 })

  /* 選了記錄之後,窄螢幕上清單必須讓位 —— 兩者並排會把詳情擠到不能用 */
  await expect(page.getByRole("option", { name: /PO-/ })).toBeHidden()

  /* app shell 不得橫向捲(#140 同型:窄寬度下版面破裂會把導覽軌捲走)*/
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  /* header 動作鈕收成純圖示,但名稱要留在 aria-label,否則螢幕閱讀器按不到 */
  await expect(page.getByRole("button", { name: "編輯", exact: true })).toBeVisible()
})
