import { expect, test } from "@playwright/test"

/* H-2 資源回收桶 UI 固化。對 dev api + 真 PG。

   固化的是**三件在瀏覽器實走才發現的事**:
   1. 標題與表單名取刪除當下的**快照** —— 原本記錄只顯示「#1」,表單刪掉後更只剩「表單 #729」
   2. 還原衝突要給出**可行動的訊息**,而不是把 partial unique 的 23505 變成 500
   3. 永久刪除要**兩段確認**,且父表單已在回收桶時仍能刪(原本回誤導的 404) */

const API = "http://localhost:3001/api"
const H = { "x-dev-tenant": "1", "content-type": "application/json" }
type Req = import("@playwright/test").APIRequestContext

async function createForm(request: Req, name: string): Promise<number> {
  const res = await request.post(`${API}/forms`, {
    headers: H,
    data: { name, fields: [{ name: "品名", type: "text" }] },
  })
  return ((await res.json()) as { id: number }).id
}

async function addRecord(request: Req, formId: number, 品名: string): Promise<void> {
  await request.post(`${API}/forms/${String(formId)}/records`, {
    headers: H,
    data: { values: { 品名 } },
  })
}

test("刪記錄 → 回收桶顯示首欄值與表單名 → 還原後資料回來", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const formId = await createForm(request, `E2E回收桶_${stamp}`)
  await addRecord(request, formId, `醬油_${stamp}`)
  await request.delete(`${API}/forms/${String(formId)}/records/1`, {
    headers: { "x-dev-tenant": "1" },
  })

  await page.goto("/app/settings/trash")
  /* 名稱帶 stamp:dev DB 會累積前幾輪(含手動實走)留下的同名回收項目,
     用固定字串會匹配到多筆 */
  const row = page.getByRole("listitem").filter({ hasText: `醬油_${stamp}` })
  await expect(row).toBeVisible({ timeout: 30_000 })
  // 標題是首欄值不是 #id;旁邊掛表單名
  await expect(row).toContainText(`E2E回收桶_${stamp}`)
  await expect(row).toContainText("天後清除")

  await row.getByRole("button", { name: "還原" }).click()
  await expect(row).toBeHidden({ timeout: 15_000 })

  const after = await request.get(`${API}/forms/${String(formId)}/records?limit=10`, {
    headers: { "x-dev-tenant": "1" },
  })
  const body = (await after.json()) as { records: { values: Record<string, unknown> }[] }
  expect(body.records.map((r) => r.values["品名"])).toContain(`醬油_${stamp}`)
})

test("🔴 同名重建後還原表單 → 明確阻擋而非 500", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const name = `E2E同名_${stamp}`
  const first = await createForm(request, name)
  await request.delete(`${API}/forms/${String(first)}`, { headers: { "x-dev-tenant": "1" } })
  await createForm(request, name) // 同名重建 → partial unique 讓還原必然撞 23505

  await page.goto("/app/settings/trash")
  const row = page.getByRole("listitem").filter({ hasText: name }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole("button", { name: "還原" }).click()

  await expect(row).toContainText("已有另一張表單叫", { timeout: 15_000 })
  await expect(row).toBeVisible() // 擋下 = 項目留在桶裡,不是消失
})

test("🔴 永久刪除需兩段確認,父表單已入桶仍可刪", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const formId = await createForm(request, `E2E硬刪_${stamp}`)
  await addRecord(request, formId, `鮪魚罐頭_${stamp}`)
  await request.delete(`${API}/forms/${String(formId)}/records/1`, {
    headers: { "x-dev-tenant": "1" },
  })
  await request.delete(`${API}/forms/${String(formId)}`, { headers: { "x-dev-tenant": "1" } })

  await page.goto("/app/settings/trash")
  const row = page.getByRole("listitem").filter({ hasText: `鮪魚罐頭_${stamp}` })
  await expect(row).toBeVisible({ timeout: 30_000 })

  // 第一下只是進入確認態 —— 不可一鍵不可逆
  await row.getByRole("button", { name: `永久刪除 鮪魚罐頭_${stamp}` }).click()
  await expect(row.getByRole("button", { name: "確定永久刪除" })).toBeVisible()
  await row.getByRole("button", { name: "確定永久刪除" }).click()
  await expect(row).toBeHidden({ timeout: 15_000 })
})
