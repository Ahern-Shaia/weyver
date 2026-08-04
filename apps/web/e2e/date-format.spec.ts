import { expect, test } from "@playwright/test"

/* 🔴 R1·FMT|日期輸入與顯示格式(`docs/modules/R1/date-and-display-format.md`)。

   釘住的是**格式的主權**:同一筆資料在所有人畫面上長得一樣,
   而那由**欄位設定**決定,不由各人的瀏覽器或租戶語系決定。

   ⚠️ **刻意不寫「在 en-US 瀏覽器下也正確」的斷言** —— CI 只跑一種語系,
   那條斷言在 CI 永遠是綠的而不代表任何事。跨語系的證據在模組文件 §0.3-bis
   的量測(截圖 + `--lang` 對照),需要時手動複測。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }

async function makeForm(request: import("@playwright/test").APIRequestContext): Promise<{
  id: number
  dateFieldId: number
}> {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `日期格式_${String(Date.now()).slice(-6)}`,
      fields: [
        { name: "品名", type: "text" },
        { name: "交期", type: "date" },
      ],
    },
  })
  const body = (await res.json()) as { id: number; fields: { id: number; name: string }[] }
  return { id: body.id, dateFieldId: body.fields.find((f) => f.name === "交期")?.id ?? 0 }
}

const setFormat = (
  request: import("@playwright/test").APIRequestContext,
  formId: number,
  fieldId: number,
  dateFormat: string,
) =>
  request.patch(`/api/engine/forms/${String(formId)}/fields/${String(fieldId)}/display`, {
    headers: DEV,
    data: { dateFormat },
  })

const dateBox = (page: import("@playwright/test").Page) =>
  page.locator('input[placeholder*="20260305"]')

async function openFill(page: import("@playwright/test").Page, formId: number): Promise<void> {
  await page.goto(`/app/builder?form=${String(formId)}`)
  await page.getByRole("tab", { name: "填單" }).click()
  await expect(dateBox(page)).toBeVisible({ timeout: 30_000 })
}

/* 🔴 逐列對應 Ragic 設計手冊 doc/51 的官方輸入例子(查證 2026-08-04)。
   原生 `<input type="date">` 這三種**一種都吃不下**。 */
test("可以打字:20260305 / 1022 / 22 都成立,依欄位格式回填", async ({ page, request }) => {
  const form = await makeForm(request)
  await setFormat(request, form.id, form.dateFieldId, "slash")
  await openFill(page, form.id)

  await dateBox(page).fill("20151022")
  await dateBox(page).press("Enter")
  await expect(dateBox(page)).toHaveValue("2015/10/22")

  /* 官方逐字:「如果你沒有輸入年份,會用現在的年份補上」 */
  await dateBox(page).fill("1022")
  await dateBox(page).press("Enter")
  await expect(dateBox(page)).toHaveValue(new RegExp("^\\d{4}/10/22$"))

  /* 官方逐字:「如果你只有輸入日子,會用現在的年份、月份來自動補齊」 */
  await dateBox(page).fill("22")
  await dateBox(page).press("Enter")
  await expect(dateBox(page)).toHaveValue(new RegExp("^\\d{4}/\\d{2}/22$"))
})

/* 🔴 解析不出來**不清空**。原生控件在這種情況是靜默不接受,
   使用者只看到自己打的字沒有變成日期,不知道為什麼。 */
test("看不懂的日期:保留使用者打的字 + 具名說明,不靜默清空", async ({ page, request }) => {
  const form = await makeForm(request)
  await openFill(page, form.id)

  await dateBox(page).fill("2026-02-30") // 2 月沒有 30 日
  await dateBox(page).press("Enter")

  await expect(dateBox(page)).toHaveValue("2026-02-30")
  await expect(dateBox(page)).toHaveAttribute("aria-invalid", "true")
  await expect(page.getByText("看不懂這個日期", { exact: false })).toBeVisible()
})

/* 🔴 這一條是整個模組的主張:**格式由欄位決定**。
   換一個格式,同一個值在畫面上就換一種寫法 —— 而所有人看到的都一樣。 */
test("換欄位格式 → 同一個值換一種寫法", async ({ page, request }) => {
  const form = await makeForm(request)
  await setFormat(request, form.id, form.dateFieldId, "iso")
  await openFill(page, form.id)
  await dateBox(page).fill("20260305")
  await dateBox(page).press("Enter")
  await expect(dateBox(page)).toHaveValue("2026-03-05")

  await setFormat(request, form.id, form.dateFieldId, "dash")
  await openFill(page, form.id)
  await dateBox(page).fill("20260305")
  await dateBox(page).press("Enter")
  /* dd-MM-yyyy —— ⚠️ 只有**顯示**重排;`20260305` 的解析與格式無關(見 date-parse.ts) */
  await expect(dateBox(page)).toHaveValue("05-03-2026")
})

/* W3C ARIA APG「Date Picker Dialog」:焦點留在 grid 容器,
   用 aria-activedescendant 指向目前格子,不逐格搬 DOM 焦點。 */
test("日曆可純鍵盤操作:方向鍵移動 + Enter 選取", async ({ page, request }) => {
  const form = await makeForm(request)
  await setFormat(request, form.id, form.dateFieldId, "iso")
  await openFill(page, form.id)

  await dateBox(page).fill("20260305")
  await dateBox(page).press("Enter")
  await page.getByRole("button", { name: "開啟日曆" }).click()

  const grid = page.getByRole("grid", { name: "日期" })
  await expect(grid).toHaveAttribute("aria-activedescendant", "d-2026-03-05")

  await page.keyboard.press("ArrowDown") // +7 天
  await expect(grid).toHaveAttribute("aria-activedescendant", "d-2026-03-12")
  await page.keyboard.press("Enter")

  await expect(dateBox(page)).toHaveValue("2026-03-12")
  await expect(grid).toBeHidden()
})
