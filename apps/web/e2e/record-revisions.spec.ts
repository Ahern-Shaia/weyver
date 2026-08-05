import { expect, test } from "@playwright/test"

/* 🔴 R1·H-4|記錄修改紀錄(`docs/modules/R1/record-revisions.md`)。

   Ragic 官方 `doc/81` 逐字:「點選修改紀錄後,會列出該筆資料**詳細的修改內容**」。
   我方原本只有 `updated_by` / `updated_at` —— 知道誰、何時,
   **不知道改了哪一欄、從什麼變成什麼**。

   這條釘的是第一約束:**不用打 API 就看得到**。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
const uniq = (): string => String(Date.now()).slice(-6)

test("🔴 記錄頁看得到「誰把什麼改成什麼」(不用打 API)", async ({ page, request }) => {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E修改紀錄_${uniq()}`,
      fields: [
        { name: "品名", type: "text" },
        { name: "數量", type: "number" },
      ],
    },
  })
  const formId = ((await res.json()) as { id: number }).id

  const created = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: DEV,
    data: { values: { 品名: "醬油", 數量: 3 } },
  })
  const row = (await created.json()) as { id: number; version: number }

  await request.patch(`/api/engine/forms/${String(formId)}/records/${String(row.id)}`, {
    headers: DEV,
    data: { expectedVersion: row.version, values: { 數量: 10 } },
  })

  await page.goto(`/app/forms/${String(formId)}?record=${String(row.id)}&mode=record`)
  const list = page.getByTestId("record-revisions")
  await expect(list).toBeVisible({ timeout: 30_000 })

  /* 🔴 更新那一筆:只列**真的變了**的欄,且前後值都在。
     ⚠️ 前值來自 DB(`numeric` 回 `3.0000000000`)、後值來自 payload ——
     兩種寫法會讓畫面變成「3.0000000000 → 10」,那看起來像壞掉。這裡釘住已正規化。 */
  const rows = list.locator("li li")
  await expect(rows.first()).toHaveText("數量3→10")

  /* 建立那一筆:記全部有值的欄,且**不畫空的箭頭**(沒有前值) */
  await expect(list).toContainText("品名")
  await expect(list.getByText("→")).toHaveCount(1)
})

/* 🔴 修改紀錄是**值的第二個出口**。主路徑遮好了不代表這裡遮好了 ——
   這一輪已經修過三次同型(公式污染閉包 / 連結標題 / 通知內容)。
   後端逐欄遮罩已有整合測試(`field-leak`),這裡釘住**端點本身**不繞過權限。 */
test("🔴 修改紀錄端點吃記錄檢視權(沒有 view 權就取不到)", async ({ request }) => {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E紀錄權限_${uniq()}`, fields: [{ name: "品名", type: "text" }] },
  })
  const formId = ((await res.json()) as { id: number }).id
  const created = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers: DEV,
    data: { values: { 品名: "醬油" } },
  })
  const recordId = ((await created.json()) as { id: number }).id

  const ok = await request.get(
    `/api/engine/forms/${String(formId)}/records/${String(recordId)}/revisions`,
    { headers: DEV },
  )
  expect(ok.status()).toBe(200)
  const body = (await ok.json()) as { revisions: { changes: unknown[] }[] }
  expect(body.revisions.length).toBeGreaterThan(0)

  /* 別的租戶拿不到(RLS + app 層雙防線) */
  const other = await request.get(
    `/api/engine/forms/${String(formId)}/records/${String(recordId)}/revisions`,
    { headers: { "x-dev-tenant": "2" } },
  )
  expect(other.status()).toBeGreaterThanOrEqual(400)
})

/* 🔴 R1·H-4 收尾|**全庫「資料修改紀錄」**(Ragic 官方 `doc/81`:漢堡選單 → 資料庫管理)。
   官方逐字:「用來檢視所有資料的修改歷程。想要瀏覽特定表單或時間的修改紀錄,可以進一步篩選。」 */
test("🔴 設定中心看得到全庫修改紀錄,且可依表單篩選", async ({ page, request }) => {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E全庫紀錄_${uniq()}`, fields: [{ name: "品名", type: "text" }] },
  })
  const form = (await res.json()) as { id: number; name: string }
  const created = await request.post(`/api/engine/forms/${String(form.id)}/records`, {
    headers: DEV,
    data: { values: { 品名: "醬油" } },
  })
  const row = (await created.json()) as { id: number; version: number }
  await request.patch(`/api/engine/forms/${String(form.id)}/records/${String(row.id)}`, {
    headers: DEV,
    data: { expectedVersion: row.version, values: { 品名: "醬油2" } },
  })

  await page.goto("/app/settings/revisions")
  await expect(page.getByRole("heading", { name: "資料修改紀錄" })).toBeVisible({ timeout: 30_000 })

  /* 篩到這張表 —— 否則 dev DB 累積的資料會讓「看得到」失去鑑別力 */
  await page.getByLabel("篩選表單").selectOption(String(form.id))
  const table = page.getByTestId("revision-log")
  await expect(table).toContainText(form.name, { timeout: 15_000 })
  await expect(table).toContainText("建立")
  await expect(table).toContainText("更新 · v2")
  /* 🔴 這一頁**只列動了哪些欄,不列值** —— 它橫跨數十張表,不做逐欄遮罩 */
  await expect(table).toContainText("品名")
  await expect(table).not.toContainText("醬油")

  /* 點得回那一筆(全庫頁的用途是找線索,線索要能追下去) */
  await table
    .getByRole("link", { name: `#${String(row.id)}` })
    .first()
    .click()
  await expect(page.getByTestId("record-revisions")).toBeVisible({ timeout: 30_000 })
})

/* 🔴 R1·H-4 v1.2|**資料庫設計變更**。Ragic 官方 `doc/81` 逐字:
   「頁面下方,可以看到**資料庫設計變更**。」—— 同一頁的下半部,不另開一頁。 */
test("🔴 同一頁下方看得到資料庫設計變更,且不外洩實際執行的語句", async ({ page, request }) => {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E設計變更_${uniq()}`, fields: [{ name: "品名", type: "text" }] },
  })
  const form = (await res.json()) as { id: number; name: string }
  const add = await request.post(`/api/engine/forms/${String(form.id)}/fields`, {
    headers: DEV,
    data: { name: "備註", type: "text" },
  })
  expect(add.status()).toBeLessThan(300)

  await page.goto("/app/settings/revisions")
  const table = page.getByTestId("design-changes")
  await expect(table).toContainText(form.name, { timeout: 30_000 })
  await expect(table).toContainText("createForm")

  /* 🔴 物理識別字與 DDL 語句不得出現在畫面上 —— 那是動態 identifier 注入的地圖。
     整頁檢查而非只查表格:洩漏可能來自任何一格。 */
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ")
  expect(body).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
  expect(body).not.toMatch(/\bt\d{2,}\b|\bf\d{2,}\b/)
})

/* 🔴 R1·H-4 v1.2|**批次還原**。Ragic 官方 `doc/81`:
   「點擊該筆修改或匯入紀錄旁的還原符號來復原修改前的資料。」
   官方截圖把整批折成一列:「修改了 4 筆資料 (大量修改) ↺」。

   這條釘的是第一約束:貼錯一整塊 Excel 之後,**不用打 API 就救得回來**。 */
test("🔴 貼上批次可以在紀錄頁一鍵還原成修改前的值", async ({ page, request }) => {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E批次還原_${uniq()}`,
      fields: [
        { name: "品名", type: "text" },
        { name: "數量", type: "number" },
      ],
    },
  })
  const form = (await res.json()) as { id: number; name: string }
  const created = await request.post(`/api/engine/forms/${String(form.id)}/records`, {
    headers: DEV,
    data: { values: { 品名: "原本的名字", 數量: 1 } },
  })
  const row = (await created.json()) as { id: number }

  const paste = await request.post(`/api/engine/forms/${String(form.id)}/records/bulk-update`, {
    headers: DEV,
    data: { rows: [{ recordId: row.id, values: { 品名: "貼錯的名字", 數量: 999 } }] },
  })
  expect(paste.status()).toBe(200)

  await page.goto("/app/settings/revisions")
  await page.getByLabel("篩選表單").selectOption(String(form.id))

  /* 整批一列:筆數 + 種類,不是逐筆展開 */
  const table = page.getByTestId("revision-log")
  await expect(table).toContainText("1 筆", { timeout: 15_000 })
  await expect(table).toContainText("貼上")

  /* ⚠️ 兩個對話框(確認 + 結果)。用兩個 `once` 會壞:兩個 handler 都在第一個
     對話框出現前就掛上了,於是**同一個對話框被兩個 handler 各接一次**,
     第二個拿到「已被處理」的錯。用 `on` 接全部。 */
  page.on("dialog", (d) => void d.accept())
  await table.getByRole("button", { name: "還原" }).first().click()

  /* 還原完那一列不再提供還原 */
  await expect(table.getByRole("button", { name: "還原" })).toHaveCount(0, { timeout: 15_000 })

  const after = await request.get(`/api/engine/forms/${String(form.id)}/records`, { headers: DEV })
  const records = (await after.json()) as { records: { values: Record<string, unknown> }[] }
  expect(records.records[0]?.values).toMatchObject({ 品名: "原本的名字" })
})
