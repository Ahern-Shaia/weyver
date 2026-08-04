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

  await page.getByRole("textbox", { name: "單號" }).fill("PO-LNK-E2E")
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

/* 🔴 R1·LNK M2|Load 帶入。

   Ragic `doc/14` 逐字:「選擇顧客姓名之後,**會自動帶出**該顧客對應的其他資訊,
   像是:聯絡電話、地址及 E-mail 等,這些對應帶入的欄位就是**載入欄位**。」

   ⚠️ 這一條釘的是**跨欄位的副作用** —— 選 A 欄會改 B、C 欄。
   單元測試看不到(那是 form state 的整體行為),只有實走看得到。 */
test("🔴 選記錄 → 對映的欄位自動帶入(Load)", async ({ page, request }) => {
  const stamp = String(Date.now()).slice(-6)
  const sup = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E帶入供應商_${stamp}`,
      fields: [
        { name: "供應商名稱", type: "text" },
        { name: "聯絡電話", type: "text" },
      ],
    },
  })
  const supBody = (await sup.json()) as { id: number; fields: { id: number; name: string }[] }
  await request.post(`/api/engine/forms/${String(supBody.id)}/records`, {
    headers: DEV,
    data: { values: { 供應商名稱: "鑫豐農產", 聯絡電話: "02-1234-5678" } },
  })

  const po = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E帶入採購單_${stamp}`,
      fields: [
        { name: "供應商", type: "link", options: { targetFormId: supBody.id } },
        { name: "電話", type: "text" },
      ],
    },
  })
  const poBody = (await po.json()) as { id: number; fields: { id: number; name: string }[] }
  const linkId = poBody.fields.find((f) => f.name === "供應商")?.id ?? 0
  const phoneLocal = poBody.fields.find((f) => f.name === "電話")?.id ?? 0
  const phoneSrc = supBody.fields.find((f) => f.name === "聯絡電話")?.id ?? 0

  const mapped = await request.patch(
    `/api/engine/forms/${String(poBody.id)}/fields/${String(linkId)}/load-map`,
    { headers: DEV, data: { loadMap: [{ fromFieldId: phoneSrc, toFieldId: phoneLocal }] } },
  )
  expect(mapped.status()).toBeLessThan(300)

  await page.goto(`/app/builder?form=${String(poBody.id)}&mode=records`)
  await page.getByRole("tab", { name: "填單" }).click()
  const supplier = page.getByLabel("供應商 選擇記錄")
  await expect(supplier).toBeVisible({ timeout: 30_000 })

  await supplier.selectOption({ label: "鑫豐農產" })

  /* 🔴 選了之後**電話欄自己填上了** —— 那正是 Load。 */
  await expect(page.getByRole("textbox", { name: "電話" })).toHaveValue("02-1234-5678", {
    timeout: 15_000,
  })
})

/* 🔴 audit-D §2.2|**顯示面**。

   `toSubmitValue` 有 `case "link"`(送出面 2026-08-04 修過),`formatFieldValue` 沒有
   —— 於是連結欄一路落到預設分支,**記錄頁與列表頁把目標記錄的數字 id 印在畫面上**。
   而模組文件 §7 逐字寫著「✅ 已出貨:候選端點 + 選記錄 UI + **可讀顯示**」。

   FMEA L2 的緩解本來寫著「e2e 斷言不得為純數字」,但當時加的斷言看的是
   **選擇器**(填單面)與 **API 回值**(儲存面)—— 顯示面零覆蓋,所以缺口活了下來。
   這一條補的就是那個洞。 */
test("🔴 顯示面:記錄頁與列表頁顯示標題,不得是數字 id", async ({ page, request }) => {
  const { poId } = await seed(request)
  await openFill(page, poId)

  await page.getByRole("textbox", { name: "單號" }).fill("PO-DISPLAY")
  await picker(page).selectOption({ label: "鑫豐農產" })
  await page.getByRole("button", { name: "儲存" }).click()
  await expect(page.getByText(/已儲存/)).toBeVisible({ timeout: 30_000 })

  /* 列表(設計器的「資料」頁籤 —— HTML 表格)。
     ⚠️ 工作區的列表頁是 **Glide canvas**,文字不在 DOM 裡,斷言不到;
     兩者走的是同一支 `formatFieldValue`,故此處覆蓋等同覆蓋。**這是誠實的限制,不是偷懶。** */
  await page.getByRole("tab", { name: "資料" }).click()
  const row = page.getByRole("row").filter({ hasText: "PO-DISPLAY" }).first()
  await expect(row).toContainText("鑫豐農產", { timeout: 30_000 })

  /* 記錄頁 */
  await page.goto(`/app/forms/${String(poId)}`)
  await page.getByRole("tab", { name: "記錄" }).click()
  /* 收斂到記錄詳情區塊 —— 同一條測試上一段已經這樣做了,這一行原本沒有 */
  await expect(page.getByRole("main").getByText("鑫豐農產").first()).toBeVisible({
    timeout: 30_000,
  })
})
