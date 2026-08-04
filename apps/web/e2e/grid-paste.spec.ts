import { expect, test } from "@playwright/test"

/* 🔴 R1·GP M3/M4|從 Excel 貼一整塊進網格。

   客戶離開 Excel 的**第一理由**是「一一複製貼上,極度耗時且容易出錯」,
   而在這之前我們的網格根本貼不進去。

   本檔釘的是**四家競品共同的反面教材**(§0.3c):
   「使用者看到成功、系統其實少做了事」—— Ragic 超量整批不重算、
   Teable「success message while the cell content remained unchanged」、
   Airtable「unmatched values are dropped」、AG Grid 超量列「will not be pasted」。
   所以每一條斷言都在問:**少做的事有沒有講出來**。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }

/* Glide 走 `navigator.clipboard.read()`(非 `e.clipboardData`)—— 要真的授權,
   否則貼上這條路徑在測試裡根本不會執行,而測試會綠得毫無意義。 */
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
})

async function seed(
  request: import("@playwright/test").APIRequestContext,
  rows: number,
): Promise<number> {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E貼上_${String(Date.now()).slice(-6)}`,
      fields: [
        { name: "品名", type: "text" },
        { name: "數量", type: "number" },
      ],
    },
  })
  const formId = ((await res.json()) as { id: number }).id
  for (let i = 1; i <= rows; i++) {
    await request.post(`/api/engine/forms/${String(formId)}/records`, {
      headers: DEV,
      data: { values: { 品名: `原值${String(i)}`, 數量: i } },
    })
  }
  return formId
}

/* Glide 是 canvas —— 沒有可定位的儲存格,只能算座標點。
   欄 0 是 52px 的「檢視」marker,標頭約 34px,列高約 34px。 */
async function pasteAt(page: import("@playwright/test").Page, tsv: string): Promise<void> {
  const box = await page.locator(".dvn-scroller").boundingBox()
  if (box === null) throw new Error("grid not found")
  await page.mouse.click(box.x + 52 + 60, box.y + 34 + 17) // 第 1 列、品名欄
  await page.evaluate((t) => navigator.clipboard.writeText(t), tsv)
  await page.keyboard.press("ControlOrMeta+v")
}

test("🔴 型別不合的格整批不送,並標紅 + 說明是哪一列(OQ-GP-5)", async ({ page, request }) => {
  const formId = await seed(request, 3)
  await page.goto(`/app/forms/${String(formId)}`)
  await expect(page.getByText("3 筆")).toBeVisible({ timeout: 30_000 })

  await pasteAt(page, "新品A\t11\n新品B\t不是數字")

  await expect(page.getByText(/有 1 格無法貼上,已整批取消/)).toBeVisible()
  await expect(page.getByText(/不是數值/)).toBeVisible()

  /* **整批**不送 —— 合法的那一列也不得偷偷寫進去 */
  const after = await request.get(`/api/engine/forms/${String(formId)}/records`, { headers: DEV })
  const body = (await after.json()) as { records: { values: Record<string, unknown> }[] }
  expect(body.records.map((r) => r.values.品名)).not.toContain("新品A")
})

test("合法的一整塊直接寫入,並可一步復原(OQ-GP-1 / M4)", async ({ page, request }) => {
  const formId = await seed(request, 3)
  await page.goto(`/app/forms/${String(formId)}`)
  await expect(page.getByText("3 筆")).toBeVisible({ timeout: 30_000 })

  await pasteAt(page, "甲\t101\n乙\t102")
  await expect(page.getByText(/已貼上/)).toBeVisible()

  const names = async (): Promise<unknown[]> => {
    const res = await request.get(`/api/engine/forms/${String(formId)}/records`, { headers: DEV })
    const b = (await res.json()) as { records: { values: Record<string, unknown> }[] }
    return b.records.map((r) => r.values.品名)
  }
  await expect.poll(names).toContain("甲")

  /* 🔴 M4:使用者按的是**一個**動作,還原也該是一個 */
  const undoReq = page.waitForResponse(
    (r) => r.url().includes("/records/bulk-update") && r.request().method() === "POST",
  )
  await page.getByRole("button", { name: "復原這次貼上" }).click()
  const res = await undoReq
  expect(res.status(), await res.text()).toBe(200)
  await expect.poll(names, { timeout: 15_000 }).toContain("原值1")
  expect(await names()).not.toContain("甲")
})

test("🔴 超出現有列數 → 先問過再加,不靜默丟棄(OQ-GP-3)", async ({ page, request }) => {
  const formId = await seed(request, 1)
  await page.goto(`/app/forms/${String(formId)}`)
  await expect(page.getByText("1 筆")).toBeVisible({ timeout: 30_000 })

  await pasteAt(page, "甲\t1\n乙\t2\n丙\t3")
  /* AG Grid 這裡是「will not be pasted」且不出聲;我方要先問 */
  await expect(page.getByText(/超出現有 2 列/)).toBeVisible()

  await page.getByRole("button", { name: "新增並貼上" }).click()
  await expect
    .poll(async () => {
      const res = await request.get(`/api/engine/forms/${String(formId)}/records`, { headers: DEV })
      return ((await res.json()) as { records: unknown[] }).records.length
    })
    .toBe(3)
})
