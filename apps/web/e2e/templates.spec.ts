import { expect, test } from "@playwright/test"

/* 🔴 R1·TPL M3|建表的第三條路。

   釘住的不是「有一個清單」,而是**按下去真的建出一組接好關聯的表** ——
   範本的價值在「打開就能用」,而那正是最容易只做到一半的地方
   (清單有了、套用壞了,畫面看起來完全正常)。 */

test("從範本建表:選單有職能與產業兩類,套用後導到包內第一張表", async ({ page }) => {
  await page.goto("/app/builder")
  await page.getByRole("button", { name: "範本", exact: true }).click()

  await expect(page.getByRole("heading", { name: "從範本開始" })).toBeVisible({ timeout: 30_000 })

  /* 每一項都要講清楚「這會建幾張表」—— 單位是包不是表,
     按下去冒出三張而使用者以為一張,那是驚嚇不是驚喜 */
  await expect(page.getByText("· 3 張表").first()).toBeVisible()

  /* OQ-TPL-8=C:產業 pack 要標出來,而通用職能不標 —— 主軸是職能 */
  await expect(page.getByText("食品加工").first()).toBeVisible()

  await page.getByRole("button", { name: "套用範本 請購申請" }).click()
  /* 套完停在原地等於要使用者自己去清單裡找 */
  await expect(page).toHaveURL(/\/app\/builder\?form=\d+/, { timeout: 30_000 })
})
