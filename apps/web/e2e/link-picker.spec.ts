import { expect, test } from "@playwright/test"

/* 🔴 R1·LNK M1|連結欄選記錄。

   在此之前連結欄在填單畫面顯示「(此型別即將推出,暫不可填)」——
   `STUB_TYPES` 逐字列著 `["link"]`,而 `formula-and-linkload` 的檔頭同時寫著
   「Link&Load SHIPPED」。**UI 一直說實話,是模組文件在過度宣稱**
   (`_audit/giants-shoulders-audit-C.md` §2.2)。

   本 spec 釘的是**使用者能不能真的用它**,而不是「元件有沒有渲染」。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }

async function seed(request: import("@playwright/test").APIRequestContext): Promise<{
  poId: number
}> {
  const stamp = String(Date.now()).slice(-6)
  const sup = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E連結供應商_${stamp}`, fields: [{ name: "供應商名稱", type: "text" }] },
  })
  const supId = ((await sup.json()) as { id: number }).id
  for (const name of ["鑫豐農產", "正大食材", "大成食品"]) {
    await request.post(`/api/engine/forms/${String(supId)}/records`, {
      headers: DEV,
      data: { values: { 供應商名稱: name } },
    })
  }
  const po = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E連結採購單_${stamp}`,
      fields: [
        { name: "單號", type: "text" },
        { name: "供應商", type: "link", options: { targetFormId: supId } },
      ],
    },
  })
  return { poId: ((await po.json()) as { id: number }).id }
}

const picker = (page: import("@playwright/test").Page) => page.getByLabel("供應商 選擇記錄")

async function openFill(page: import("@playwright/test").Page, poId: number): Promise<void> {
  await page.goto(`/app/builder?form=${String(poId)}&mode=records`)
  await page.getByRole("tab", { name: "填單" }).click()
  await expect(picker(page)).toBeVisible({ timeout: 30_000 })
}

test("連結欄可以選記錄,且選項是標題不是 id", async ({ page, request }) => {
  const { poId } = await seed(request)
  await openFill(page, poId)

  /* 🔴 若這裡看到的是數字,等於使用者要自己認 id —— 那就是修這條之前的狀態 */
  await expect(picker(page)).toContainText("鑫豐農產")
  await expect(picker(page)).toContainText("正大食材")
})

test("搜尋縮到相符的那一筆", async ({ page, request }) => {
  const { poId } = await seed(request)
  await openFill(page, poId)

  await page.getByLabel("供應商 搜尋").fill("正大")
  await expect(picker(page).locator("option")).toHaveCount(2) // 未選擇 + 正大食材
  await expect(picker(page)).toContainText("正大食材")
})

/* 🔴 這一條釘的是**送出邊界**,不是 UI。

   `toSubmitValue` 原本沒有列 `link`,於是它落到 default 的字串分支被丟掉 ——
   畫面上明明選了供應商,**存進去卻是 null,而且沒有任何錯誤**。
   同一個坑 `member` 欄踩過(#96),`value.ts` 裡有一段註解逐字寫著,
   而 link 還是踩了 —— 因為那條規則只寫在註解裡,沒有任何機制在漏列時發出訊號。

   兩次都是瀏覽器實走才發現的:單元測試不會送出、型別上 `unknown` 一路綠燈。 */
test("🔴 選了要存得進去 —— 送出邊界不得靜默丟掉", async ({ page, request }) => {
  const { poId } = await seed(request)
  await openFill(page, poId)

  /* ⚠️ 收斂到填寫區塊再取第一個 textbox(同 `builder.spec` 的做法)——
     整頁範圍的 `.first()` 會打到左欄的「搜尋表單」框。
     ⚠️ 這裡沒有用欄位名當錨點,因為**欄位輸入在無障礙樹上還沒有名字**(見 field-input.tsx 註解)。 */
  const fill = page.locator("section").filter({ hasText: "填寫" }).last()
  await fill.getByRole("textbox").first().fill("PO-LNK-E2E")
  await picker(page).selectOption({ label: "鑫豐農產" })
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText(/已儲存/)).toBeVisible({ timeout: 30_000 })

  const res = await request.get(`/api/engine/forms/${String(poId)}/records`, { headers: DEV })
  const body = (await res.json()) as { records: { values: Record<string, unknown> }[] }
  const row = body.records.find((r) => r.values["單號"] === "PO-LNK-E2E")
  expect(row).toBeDefined()
  /* 值是目標記錄的 id(數字或 pg 回的字串),**不得是 null** */
  expect(row?.values["供應商"]).not.toBeNull()
  expect(String(row?.values["供應商"] ?? "")).toMatch(/^\d+$/)
})
