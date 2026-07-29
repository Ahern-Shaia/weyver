import { expect, test } from "@playwright/test"

/* F-1 分組 / 看板 / 行事曆 UI 固化。對 dev api + 真 PG。

   **自建資料而非依賴既有表單**|三個檢視都需要特定欄型(單選 / 日期),
   而 dev DB 的既有表單欄位組成會隨開發變動 —— 依賴它們會讓這份 spec 隨機紅。 */

async function createForm(
  request: import("@playwright/test").APIRequestContext,
  name: string,
  fields: unknown[],
): Promise<number> {
  const res = await request.post("http://localhost:3001/api/forms", {
    headers: { "x-dev-tenant": "1", "content-type": "application/json" },
    data: { name, fields },
  })
  const body = (await res.json()) as { id: number }
  return body.id
}

async function addRecord(
  request: import("@playwright/test").APIRequestContext,
  formId: number,
  values: Record<string, unknown>,
): Promise<void> {
  await request.post(`http://localhost:3001/api/forms/${String(formId)}/records`, {
    headers: { "x-dev-tenant": "1", "content-type": "application/json" },
    data: { values },
  })
}

test("分組:群組標頭顯示後端計數,折疊後記錄從查詢排除", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const formId = await createForm(request, `E2E分組_${stamp}`, [
    { name: "客戶", type: "text" },
    { name: "狀態", type: "singleSelect", options: { choices: ["新單", "已完成"] } },
  ])
  await addRecord(request, formId, { 客戶: "甲", 狀態: "新單" })
  await addRecord(request, formId, { 客戶: "乙", 狀態: "新單" })
  await addRecord(request, formId, { 客戶: "丙", 狀態: "已完成" })

  await page.goto(`/app/forms/${String(formId)}?mode=list`)
  await page.getByRole("button", { name: "分組" }).click({ timeout: 30_000 })
  await page.getByRole("button", { name: "加入分組欄位" }).click()
  await page.getByLabel("分組欄位 1").selectOption("狀態")

  // 兩個群組標頭 + 後端計數
  await expect(page.getByText("新單", { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText("2 筆")).toBeVisible()

  /* 折疊「已完成」→ 該群的記錄從查詢排除,但標頭與計數仍在
     (若只在前端隱藏,那些記錄仍會吃掉 page size) */
  const before = await page.locator("table tbody tr").count()
  await page.getByRole("button", { name: /已完成/ }).first().click()
  await expect(page.locator("table tbody tr")).toHaveCount(before - 1)
  await expect(page.getByText("1 筆")).toBeVisible()
})

test("看板:依單選欄分欄,拖曳改值寫入 DB", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const formId = await createForm(request, `E2E看板_${stamp}`, [
    { name: "標題", type: "text" },
    { name: "狀態", type: "singleSelect", options: { choices: ["待辦", "完成"] } },
  ])
  await addRecord(request, formId, { 標題: "任務甲", 狀態: "待辦" })

  await page.goto(`/app/forms/${String(formId)}?mode=kanban`)
  await expect(page.getByLabel("看板分欄依據")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("任務甲")).toBeVisible()

  const card = page.getByText("任務甲")
  const target = page.locator('[data-stack="完成"]')
  const cb = await card.boundingBox()
  const tb = await target.boundingBox()
  expect(cb).not.toBeNull()
  expect(tb).not.toBeNull()
  if (cb === null || tb === null) return

  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 60, { steps: 12 })
  await page.mouse.up()

  // 寫入 DB(而非僅前端移動)
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `http://localhost:3001/api/forms/${String(formId)}/records`,
          { headers: { "x-dev-tenant": "1" } },
        )
        const body = (await res.json()) as { records: { values: Record<string, unknown> }[] }
        return body.records[0]?.values.狀態
      },
      { timeout: 15_000 },
    )
    .toBe("完成")
})

test("行事曆:跨月事件在兩個月都顯示", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const formId = await createForm(request, `E2E行事曆_${stamp}`, [
    { name: "事由", type: "text" },
    { name: "開始", type: "date" },
    { name: "結束", type: "date" },
  ])
  await addRecord(request, formId, { 事由: "跨月假", 開始: "2026-07-29", 結束: "2026-08-03" })

  await page.goto(`/app/forms/${String(formId)}?mode=calendar`)
  await expect(page.getByLabel("行事曆日期欄")).toBeVisible({ timeout: 30_000 })
  await page.getByLabel("行事曆結束欄").selectOption("結束")

  // 當月(2026-07)顯示;切到下個月仍顯示 —— 一筆佔多格
  await expect(page.getByRole("button", { name: "跨月假" }).first()).toBeVisible({
    timeout: 15_000,
  })
  await page.getByLabel("下個月").click()
  await expect(page.getByRole("button", { name: "跨月假" }).first()).toBeVisible({
    timeout: 15_000,
  })
})
