import { expect, test } from "@playwright/test"

/* 🔴 F-2 M4|小圖表。本檔盯的是兩條**退化時畫面完全正常**的性質:

   OQ-PC-10 = A|列表頁的 widget **跟著當下的篩選走**。
   不跟著走的話,使用者把列表篩成「南區」而旁邊那張圖還顯示全區 ——
   圖畫得出來、數字也是真的,只有範圍不對,而他會拿它去開會。

   OQ-PC-11 = A|對分組欄無權限時給**具名理由**,不是空白圖。
   空白圖會被當成「沒資料」,那是最糟的誤導。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }

test("列表頁小圖表:跟著篩選連動,且不可用時給具名理由", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E小圖表_${stamp}`,
      fields: [{ name: "區域", type: "singleSelect", options: { choices: ["北區", "南區"] } }],
    },
  })
  const formId = ((await res.json()) as { id: number }).id
  await request.post(`/api/engine/forms/${String(formId)}/records/bulk`, {
    headers: DEV,
    data: {
      rows: [
        { values: { 區域: "北區" } },
        { values: { 區域: "北區" } },
        { values: { 區域: "南區" } },
      ],
    },
  })
  await request.post(`/api/engine/forms/${String(formId)}/widgets`, {
    headers: DEV,
    data: { name: "各區筆數", dimension: "區域", chartType: "bar" },
  })
  /* 維度欄不存在 = 等同無權 / 已刪 —— 走的是同一條 fail-closed */
  await request.post(`/api/engine/forms/${String(formId)}/widgets`, {
    headers: DEV,
    data: { name: "壞圖", dimension: "沒有這個欄" },
  })

  await page.goto(`/app/forms/${String(formId)}`)
  /* ⚠️ ECharts 啟用 aria 後會**覆寫容器的 aria-label**,換成自動產生的資料描述,
     呼叫端傳的名稱會被吃掉 —— 已在 `chart.tsx` 併進 `aria.label.description`,
     故此處以「名稱 + 資料」同時出現來斷言。 */
  const figure = page.getByRole("figure", { name: "各區筆數 圖表" })
  await expect(figure).toBeVisible({ timeout: 30_000 })
  /* 資料描述由 ECharts 產在內層 —— 名稱與資料**兩者都在**才算對 */
  const data = figure.locator('[role="img"]')
  await expect(data).toHaveAttribute("aria-label", /北區/)

  /* 🔴 OQ-PC-11:具名理由,而不是一張空白圖 */
  await expect(page.getByText(/無法顯示.*沒有這個欄.*沒有存取權/)).toBeVisible()

  /* 🔴 OQ-PC-10:篩選後北區必須消失 */
  await page.getByPlaceholder("搜尋此表單…").fill("南區")
  await expect(data).toHaveAttribute("aria-label", /南區/)
  await expect(data).not.toHaveAttribute("aria-label", /北區/)
})
