import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"

/* R1·I-1 M5|資料匯出 UI 固化。對 dev api + 真 PG + 真 worker。

   🔴 **這支 e2e 必須跑到 `ready` 並真的把檔案拿下來**,不能只驗畫面渲染。
   理由是 M2 實測踩到的:`archiver` 是 CJS,而 **vitest 與 tsx 的 interop 形狀不同**
   —— 單元測試 9 條全綠、真伺服器一按匯出就 `createArchive is not a function`,
   錯誤只出現在 dev server 的 stderr。只有跑在 tsx 上的 e2e 攔得住這一類。

   ⚠️ **本檔每跑一次會消耗租戶當日 1 次匯出額度**(上限 10 次/日,`EXPORT_MAX_PER_DAY`)。
   刻意只用一個測試涵蓋整條路徑,而不是拆成多個各建一份。 */

/* zip 的 local file header 魔術數(PK 後接 0x03 0x04)。
   以 hex 比對而非字面控制字元 —— 原始位元組寫進原始碼會被各種工具改壞。 */
const ZIP_MAGIC = "504b0304"

test("🔴 建立匯出 → 等到可下載 → 取得可解壓的封存檔,且只扣一次額度", async ({ page }) => {
  await page.goto("/app/settings/data-export")
  await expect(page.getByRole("heading", { name: "資料匯出" })).toBeVisible({ timeout: 30_000 })

  /* 同時只能有一個在跑;前一輪殘留時按鈕是停用的 */
  const create = page.getByRole("button", { name: "建立匯出" })
  await expect(create).toBeEnabled({ timeout: 60_000 })

  /* 🔴 **先等列數增加再取 `.first()`**。dev DB 有既有的封存檔,而按下建立到清單重抓
     之間有一段空窗 —— 這段時間 `.first()` 指的還是上一筆,對它斷言「可下載」會
     立刻通過,然後在下一句對著換過來的新列失敗(第一版就是這樣紅的)。 */
  const rows = page.getByRole("main").getByRole("listitem")
  const before = await rows.count()
  await create.click()
  await expect(rows).toHaveCount(before + 1, { timeout: 30_000 })

  /* worker 是 5 秒輪詢一次的背景工作,不是同步產生 —— 等狀態自己翻成「可下載」。
     這一段同時證明清單有在輪詢,不需要使用者自己重整。 */
  const row = rows.first()
  await expect(row.getByText("可下載")).toBeVisible({ timeout: 90_000 })
  await expect(row.getByText("剩 5 次")).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: "下載" }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^weyver-export-\d+\.zip$/)

  /* 🔴 驗**位元組**而不只是「有觸發下載」:錯誤頁 / 空檔案一樣會觸發下載事件 */
  const file = readFileSync(await download.path())
  expect(file.subarray(0, 4).toString("hex")).toBe(ZIP_MAGIC)
  expect(file.byteLength).toBeGreaterThan(200)

  /* 🔴 一次下載只能扣一次。剩餘次數由後端算,前端重抓後才會變 ——
     這條同時擋掉「按一下送兩次」與「前端自己減」兩種錯法。 */
  await expect(row.getByText("剩 4 次")).toBeVisible()
})

test("說明必須讓使用者分得出這裡與列表頁的「匯出」不是同一件事", async ({ page }) => {
  await page.goto("/app/settings/data-export")
  await expect(page.getByRole("heading", { name: "資料匯出" })).toBeVisible({ timeout: 30_000 })
  /* 列表頁那顆匯出鈕只含已載入的列。兩者的失效方式不同(少一列 vs 資料遺失),
     說明沒講清楚的話,使用者會以為自己已經備份過了。 */
  await expect(page.getByText("只含畫面上已載入的資料")).toBeVisible()
  /* 保留期與限次要在檯面上,不能等使用者第 6 次按下去才發現 */
  await expect(page.getByText("每份限下載 5 次")).toBeVisible()
})
