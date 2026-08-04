import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"

/* R1·UP-2 views-list UI 固化:集合(browse)視圖 + 雙模式 + 快速搜尋 + 篩選面板 + 儲存檢視 + 匯出。
   對 dev api + 真 PG;用採購單(form 1,dev DB 有記錄,含供應商「正大食材」),沿用 builder.spec 依賴假設。 */

test("集合視圖:列表渲染 + 快速搜尋", async ({ page }) => {
  await page.goto("/app/forms/1?mode=list")

  // 控制列:預設檢視選擇器 + 篩選/排序/另存
  await expect(page.getByRole("combobox").first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "篩選" })).toBeVisible()
  await expect(page.getByRole("button", { name: "另存" })).toBeVisible()

  // 快速搜尋「正大」→ 只剩 1 筆(PO-0003 正大食材)
  await page.getByPlaceholder("搜尋此表單…").fill("正大")
  await expect(page.getByText("1 筆")).toBeVisible()
})

test("集合視圖:篩選面板加條件", async ({ page }) => {
  await page.goto("/app/forms/1?mode=list")
  await page.getByRole("button", { name: "篩選" }).click()
  await expect(page.getByText("符合")).toBeVisible()
  await page.getByRole("button", { name: "加條件" }).click()
  // 條件列出現(欄位 + operator + 值 selects/inputs;至少多出欄位 combobox)
  await expect(page.getByRole("combobox").nth(1)).toBeVisible()
})

/* 🔴 列表頁的「匯出 Excel」是**所見即所得**,不是原始資料 ——
   兩種匯出在本專案是刻意分開的兩件事(見 `docs/modules/R1/data-export.md` §0):
   · 這一支:畫面上那些列、畫面上那些字。**看的便利**
   · 設定中心的租戶封存(CSV + zip):原值不格式化,供再匯入。**帶得走**

   ⚠️ 原本這條只驗副檔名 —— 那連「檔案裡有沒有東西」都沒問。
   R1·FMT M1 把顯示收成單一來源之後,這裡是**唯一**能證明匯出真的跟著畫面走的地方。 */
test("集合視圖:匯出 Excel —— 內容與畫面一致(不是資料庫原值)", async ({ page }) => {
  await page.goto("/app/forms/1?mode=list")
  await expect(page.getByText(/筆/).first()).toBeVisible({ timeout: 30_000 })
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "匯出 Excel" }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/)

  const path = await download.path()
  const { read, utils } = await import("xlsx")
  const wb = read(await readFile(path), { type: "buffer" })
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""]
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet ?? {})
  expect(rows.length).toBeGreaterThan(0)

  /* 🔴 金額必須是**畫面上的寫法**(千分位 + 幣別小數位),
     不得是引擎的 `numeric(19,4)` 原始表示 `128400.0000` ——
     那正是 `display-value.ts` 檔頭逐字說要修的症狀,而列表頁曾經漏接。 */
  const money = rows.map((r) => String(r["金額"] ?? "")).filter((v) => v !== "")
  expect(money.length).toBeGreaterThan(0)
  for (const v of money) {
    expect(v).not.toMatch(/^\d+\.0000$/)
    expect(v).toMatch(/,/)
  }
})

test("另存個人檢視 → 出現於檢視選擇器", async ({ page }) => {
  const name = `E2E檢視_${Date.now().toString().slice(-6)}`
  page.on("dialog", async (dialog) => {
    // 第一個 = prompt(名稱)→ 接受;第二個 = confirm(是否共通)→ 取消(個人)
    if (dialog.type() === "prompt") await dialog.accept(name)
    else await dialog.dismiss()
  })
  await page.goto("/app/forms/1?mode=list")
  await expect(page.getByRole("button", { name: "另存" })).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "另存" }).click()
  await expect(page.getByText(/已儲存檢視/)).toBeVisible()
  await expect(page.getByRole("option", { name: new RegExp(name) })).toBeAttached()
})

test("雙模式:列表 → 記錄(Object Page)", async ({ page }) => {
  await page.goto("/app/forms/1?mode=list")
  await page.getByRole("tab", { name: "記錄" }).click()
  await expect(page).toHaveURL(/mode=record/)
  await expect(page.getByRole("button", { name: "複製" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("基本資料").first()).toBeVisible()
})

test("🔴 切換記錄必須重置編輯狀態 —— 否則 A 的值會寫進 B", async ({ page, request }) => {
  const uniq = Date.now().toString().slice(-6)
  const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }

  const form = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E切換_${uniq}`, fields: [{ name: "品名", type: "text", required: true }] },
  })
  const formId = (await form.json()).id as number
  for (const name of ["記錄甲", "記錄乙"]) {
    await request.post(`/api/engine/forms/${formId}/records`, {
      headers: DEV,
      data: { values: { 品名: name } },
    })
  }

  await page.goto(`/app/forms/${formId}?mode=record`)
  await expect(page.getByRole("button", { name: "編輯" })).toBeVisible({ timeout: 30_000 })

  // 在第一筆進入編輯並改值,但**不儲存**
  await page.getByRole("button", { name: "編輯" }).click()
  const input = page.getByRole("textbox").first()
  await input.fill("被汙染的值")

  /* 切到第二筆。**會先跳未儲存變更的確認**(#110:Fiori 要求離開編輯前警示)——
     這裡確認捨棄,因為本測試要驗的是「切過去之後草稿不得殘留」。
     Playwright 預設會自動 dismiss 對話框,不接的話等於按了「不要離開」,
     切換根本不會發生,看起來像重置壞了。 */
  page.once("dialog", (d) => {
    void d.accept()
  })
  await page.getByText("記錄乙").first().click()

  /* 關鍵斷言:切換後必須回到唯讀(編輯狀態已重置),
     且畫面顯示的是記錄乙的值而非殘留的草稿。
     無 key 時 ObjectPage 不重掛 → 仍在編輯模式且草稿殘留 → 按儲存即寫錯記錄。 */
  await expect(page.getByRole("button", { name: "編輯" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("被汙染的值")).toHaveCount(0)

  // 資料庫端確認兩筆都沒被汙染
  const list = await request.get(`/api/engine/forms/${formId}/records?limit=50`, { headers: DEV })
  const names = (await list.json()).records.map(
    (r: { values: Record<string, string> }) => r.values.品名,
  )
  expect(names.sort()).toEqual(["記錄乙", "記錄甲"])
})
