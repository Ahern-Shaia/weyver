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
