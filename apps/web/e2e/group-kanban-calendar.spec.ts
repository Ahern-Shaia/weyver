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
  await page
    .getByRole("button", { name: /已完成/ })
    .first()
    .click()
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
        const res = await request.get(`http://localhost:3001/api/forms/${String(formId)}/records`, {
          headers: { "x-dev-tenant": "1" },
        })
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
  /* 🔴 日期必須**相對於今天**算。原本寫死 2026-07-29 → 2026-08-03 並假設
     「當月 = 2026-07」;行事曆開在**今天所在的月份**,所以這支測試在 2026-08-01
     零時自己爆掉 —— 寫死日期的測試是定時炸彈,而且爆的時候看起來像功能壞了。
     改成「本月最後一天 → 下月第 3 天」,無論今天是哪一天都橫跨兩個月。 */
  const iso = (d: Date): string => d.toISOString().slice(0, 10)
  const now = new Date()
  const lastOfThisMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0))
  const thirdOfNextMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 3))
  await addRecord(request, formId, {
    事由: "跨月假",
    開始: iso(lastOfThisMonth),
    結束: iso(thirdOfNextMonth),
  })

  await page.goto(`/app/forms/${String(formId)}?mode=calendar`)
  await expect(page.getByLabel("行事曆日期欄")).toBeVisible({ timeout: 30_000 })
  await page.getByLabel("行事曆結束欄").selectOption("結束")

  // 當月顯示;切到下個月仍顯示 —— 一筆佔多格
  await expect(page.getByRole("button", { name: "跨月假" }).first()).toBeVisible({
    timeout: 15_000,
  })
  await page.getByLabel("下個月").click()
  await expect(page.getByRole("button", { name: "跨月假" }).first()).toBeVisible({
    timeout: 15_000,
  })
})

test("樞紐:雙軸交叉表 + 雙向小計", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const formId = await createForm(request, `E2E樞紐_${stamp}`, [
    { name: "區域", type: "singleSelect", options: { choices: ["北", "南"] } },
    { name: "狀態", type: "singleSelect", options: { choices: ["新單", "完成"] } },
  ])
  await addRecord(request, formId, { 區域: "北", 狀態: "新單" })
  await addRecord(request, formId, { 區域: "北", 狀態: "新單" })
  await addRecord(request, formId, { 區域: "南", 狀態: "完成" })

  await page.goto(`/app/forms/${String(formId)}?mode=pivot`)
  await expect(page.getByLabel("列軸 1", { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel("加入欄軸").click()
  await page.getByLabel("欄軸 1", { exact: true }).selectOption("狀態")

  // 北×新單 = 2;列小計「北」= 2;欄小計「新單」= 2
  const table = page.locator("table")
  await expect(table).toContainText("新單", { timeout: 15_000 })
  await expect(table.locator("tbody tr").first()).toContainText("2")
})

test("圖表:繪出 canvas 且附可讀資料表", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const formId = await createForm(request, `E2E圖表_${stamp}`, [
    { name: "區域", type: "singleSelect", options: { choices: ["北", "南"] } },
  ])
  await addRecord(request, formId, { 區域: "北" })
  await addRecord(request, formId, { 區域: "南" })

  await page.goto(`/app/forms/${String(formId)}?mode=chart`)
  await expect(page.getByLabel("圖表類型")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 })

  /* a11y:圖表必須有正確的描述(不是 ECharts 自動生成那個會唸出軸索引的版本),
     且旁邊要有資料表 —— ECharts 鍵盤導覽有已知缺陷,純圖形不可用 */
  const desc = await page.locator('[role="img"]').getAttribute("aria-label")
  expect(desc).toContain("北")
  /* 每個分類只帶一個數值 —— ECharts 自動描述在 category 軸下會唸成「北 0,1」
     (0 是 x 軸索引),那是錯誤資訊。此處斷言不出現「值, 值」的兩數格式。 */
  expect(desc).not.toMatch(/\d+,\d+/)
  expect(desc).toMatch(/北 \d+/)
  await expect(page.getByText("圖表資料")).toBeVisible()
})
