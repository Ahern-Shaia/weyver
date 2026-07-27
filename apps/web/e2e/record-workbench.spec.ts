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
  await expect(page.getByText("128400.0000").first()).toBeVisible()
  const listItem = page.getByRole("button", { name: /PO-.*待審.*128400/ })
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
  await page.getByRole("combobox").selectOption("已核准")
  await page.getByRole("button", { name: "儲存", exact: true }).click()

  await expect(page.getByText("已儲存")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("#1 · v2")).toBeVisible()
  // 狀態章與左欄清單同步(同一份 query cache)
  await expect(page.getByRole("button", { name: /PO-.*已核准/ })).toBeVisible()
  // 已回到檢視模式(不再有輸入框)
  await expect(page.getByRole("combobox")).toBeHidden()
})
