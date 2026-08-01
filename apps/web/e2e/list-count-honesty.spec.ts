import { expect, test } from "@playwright/test"

/* 🔴 列表頁尾的筆數**不得把分頁大小講成事實**(docs/28 §5-bis V5)。

   `records` 是「已載入的頁」之合計(`pages.flatMap`),網格一頁 200。
   在此之前,一張 212 筆的表在頁尾顯示「200 筆」—— 使用者沒有理由不相信那句話,
   而它是錯的。docs/14 把筆數列為**信任訊號**:錯的信任訊號比沒有更糟。

   對照 Metabase(自架實走截圖 `metabase-05-table-grid.png`):同一個位置寫的是
   `Showing first 2,000 rows` —— 走**誠實截斷**而非另跑一次 COUNT。
   大租戶表上為了頁尾一個數字去 COUNT(*) 不划算,而誠實的措辭是零成本的。

   本測試釘住:尚有未載入頁時必須是「已載入 N 筆」,全部載完才可以說「N 筆」。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }
/* 網格用的 `useInfiniteRecords` 一頁 200(list 端點上限,OQ-GEI-2=A),非 50。 */
const PAGE_SIZE = 200

test("列表筆數:未載完時不得宣稱總數", async ({ page, request }) => {
  const tag = Date.now().toString().slice(-6)
  const created = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E分頁信任_${tag}`, fields: [{ name: "品名", type: "text" }] },
  })
  expect(created.status()).toBe(201)
  const form = (await created.json()) as { id: number }

  /* 要跨過一整頁才看得出問題 —— 剛好 50 筆時 `hasNextPage` 的行為與 51 筆不同。 */
  const total = PAGE_SIZE + 12
  for (let i = 1; i <= total; i += 1) {
    await request.post(`/api/engine/forms/${String(form.id)}/records`, {
      headers: DEV,
      data: { values: { 品名: `料號-${String(i)}` } },
    })
  }

  await page.goto(`/app/forms/${String(form.id)}`)
  const footer = page.getByText(/筆$|筆 ·/).first()
  await expect(footer).toBeVisible()

  /* 🔴 核心斷言:此時**只載入了 50 筆**,頁尾不得寫成「50 筆」。 */
  await expect(footer).toHaveText(/^已載入 \d+ 筆/)
  await expect(footer).not.toHaveText(new RegExp(`^${String(PAGE_SIZE)} 筆`))

  /* 全部載完之後,才可以直接說「N 筆」。 */
  const more = page.getByRole("button", { name: /載更多/ })
  while (await more.isVisible().catch(() => false)) {
    await more.click()
    await page.waitForTimeout(600)
  }
  await expect(footer).toHaveText(new RegExp(`^${String(total)} 筆`))
})
