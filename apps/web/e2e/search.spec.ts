import { type APIRequestContext, expect, test } from "@playwright/test"
import { openPalette } from "./hydration"

/* R1·H-3 M4|⌘K 跨表全文搜尋。

   後端行為(pg_bigm 繁中 2 字、RLS、權限 pre-filter)由 api 的
   `search.integration.test.ts` 對真 PG 固化;本檔只固化**瀏覽器這一端**:
   面板真的送查詢、結果分區顯示、可導到那一筆記錄、以及切租戶後看不到別人的。 */

const T1 = { "x-dev-tenant": "1", "x-dev-actor": "1" }
const T2 = { "x-dev-tenant": "2", "x-dev-actor": "1" }
const uniq = (): string => Date.now().toString().slice(-6)

async function seedForm(
  request: APIRequestContext,
  headers: Record<string, string>,
  name: string,
  value: string,
): Promise<number> {
  const form = await request.post("/api/engine/forms", {
    headers,
    data: { name, fields: [{ name: "品名", type: "text" }] },
  })
  expect(form.status()).toBe(201)
  const formId = (await form.json()).id as number
  const rec = await request.post(`/api/engine/forms/${String(formId)}/records`, {
    headers,
    data: { values: { 品名: value } },
  })
  expect(rec.status()).toBe(201)
  return formId
}

test("⌘K 搜得到**別張表**裡的記錄內容,並可直接開到那一筆", async ({ page, request }) => {
  const tag = uniq()
  /* 兩張不同的表 —— 「跨表」是本模組的重點,單表搜尋不算 */
  const formA = await seedForm(request, T1, `E2E搜尋甲_${tag}`, `鮮勇冷凍蔬菜${tag}`)
  await seedForm(request, T1, `E2E搜尋乙_${tag}`, `鮮勇常溫飲品${tag}`)

  await page.goto("/app")
  await openPalette(page, `鮮勇冷凍蔬菜${tag}`)

  /* 結果接在導覽項之後、以「記錄」分區隔開(見 command-palette.tsx 的索引穩定性註解) */
  await expect(page.getByText("記錄", { exact: true })).toBeVisible({ timeout: 30_000 })
  const hit = page.getByRole("button").filter({ hasText: `鮮勇冷凍蔬菜${tag}` })
  await expect(hit).toBeVisible()
  // 命中列要說得出「哪一欄、哪一張表」,否則跨表結果無從判讀
  await expect(hit).toContainText("品名")
  await expect(hit).toContainText(`E2E搜尋甲_${tag}`)

  await hit.click()
  /* 記錄模式的 master-detail 需 mode + rid 兩個參數,只給 rid 會停在列表。
     逾時放寬:dev server 首次進入該路由要即時編譯,預設 5 秒會偽陽性。 */
  await expect(page).toHaveURL(new RegExp(`/app/forms/${String(formA)}\\?mode=record&rid=\\d+`), {
    timeout: 30_000,
  })
})

test("繁中 2 字即可搜出兩張表的記錄(pg_bigm 的實際效益)", async ({ page, request }) => {
  const tag = uniq()
  await seedForm(request, T1, `E2E兩字甲_${tag}`, `鮮勇冷凍蔬菜${tag}`)
  await seedForm(request, T1, `E2E兩字乙_${tag}`, `鮮勇常溫飲品${tag}`)

  await page.goto("/app")
  /* 「鮮勇」是 2 個字 —— trigram 在此會退回全表掃描,PG 內建 to_tsvector 則完全搜不到。
     這一條就是整個 pg_bigm 選型的使用者可見結果。 */
  await openPalette(page, "鮮勇")

  await expect(page.getByRole("button").filter({ hasText: `E2E兩字甲_${tag}` })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole("button").filter({ hasText: `E2E兩字乙_${tag}` })).toBeVisible()
})

test("只打 1 個字不送查詢(bigram 需 2 字元,否則退化全表掃描)", async ({ page, request }) => {
  const tag = uniq()
  await seedForm(request, T1, `E2E一字_${tag}`, `鮮勇冷凍蔬菜${tag}`)

  await page.goto("/app")
  let searchCalls = 0
  page.on("request", (r) => {
    if (r.url().includes("/api/engine/search")) searchCalls += 1
  })

  await openPalette(page, "鮮")
  await page.waitForTimeout(1_000) // 遠超過 220ms debounce
  expect(searchCalls).toBe(0)
  await expect(page.getByText("記錄", { exact: true })).toHaveCount(0)
})

/* 🔴 S1(P0)|跨租戶隔離。
   刻意讓乙租戶**也有自己的資料**並斷言搜得到 —— 否則「搜不到甲租戶」可能只是因為
   乙租戶一張表都沒有(readableFormIds 為空即提前回傳),測試會因錯的理由通過。 */
test("🔴 切到另一個租戶:搜得到自己的,搜不到前一個租戶的", async ({ page, request }) => {
  const tag = uniq()
  await seedForm(request, T1, `E2E甲租戶_${tag}`, `甲租戶機密品名${tag}`)
  await seedForm(request, T2, `E2E乙租戶_${tag}`, `乙租戶自有品名${tag}`)

  await page.goto("/app")
  await page.evaluate(() => {
    window.localStorage.setItem("weyver.devTenant", "2")
  })
  await page.goto("/app")

  await openPalette(page, `乙租戶自有品名${tag}`)
  await expect(page.getByRole("button").filter({ hasText: `E2E乙租戶_${tag}` })).toBeVisible({
    timeout: 30_000,
  })

  await page.getByPlaceholder("搜尋表單、記錄、設定…").fill(`甲租戶機密品名${tag}`)
  await expect(page.getByText("無相符結果")).toBeVisible({ timeout: 30_000 })
})
