import { expect, test } from "@playwright/test"

/* 🔴 #140|窄寬度版面不得破裂。

   這一組是**量測型**測試,不是看畫面 —— 上次就是靠量測才定位到根因,
   而看截圖只能看出「怪怪的」。三條不變量各自對應一個真實壞掉過的東西:

   1. **root 不得橫向捲**|`main` 原本缺 `min-w-0`,flex 子項預設 `min-width:auto`
      → 設計器 min-content ≈ 1174px,視窗窄於此時 main 不縮反而把整個 app shell 撐寬。
   2. **導覽軌恆在 left=0**|承上,app shell 一橫捲,左側導覽軌就跟著捲走 ——
      使用者回報的「跑出版」其實是這個。
   3. **主要動作點得到**|設計器工具列原是單一 flex row(儲存鈕 `ml-auto`),
      沒有 `min-w-0` 也沒有 overflow → 整列溢出畫布欄、**壓在右側欄位設定面板底下**。
      實測儲存鈕 l=1029 而面板 l=1024,`elementFromPoint` 取到的是面板。
      這條用 `elementFromPoint` 而非 `toBeVisible()` —— **被蓋住的元素仍然「可見」**。 */

const WIDTHS = [1440, 1280, 1100, 900] as const

for (const width of WIDTHS) {
  test(`設計器 ${width}px:版面不破、導覽軌不動、主要動作點得到`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto("/app/builder?form=1")
    await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })

    // 開啟右側欄位設定面板 —— 沒開的話最容易壞的那個組合根本不會出現
    await page.locator('div[role="button"]:has-text("單行文字")').first().click()
    await expect(page.getByRole("textbox", { name: "提示文字(placeholder)" })).toBeVisible()

    const m = await page.evaluate(() => {
      const root = document.querySelector("div.h-screen") as HTMLElement
      const nav = document.querySelector("nav") as HTMLElement
      const save = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("儲存版面"),
      ) as HTMLElement
      const r = save.getBoundingClientRect()
      const top = document.elementFromPoint(
        Math.round(r.left + r.width / 2),
        Math.round(r.top + r.height / 2),
      )
      return {
        rootScrollsX: root.scrollWidth > root.clientWidth,
        navLeft: Math.round(nav.getBoundingClientRect().left),
        saveOnTop: top !== null && (top === save || save.contains(top)),
      }
    })

    expect(m.rootScrollsX).toBe(false)
    expect(m.navLeft).toBe(0)
    expect(m.saveOnTop).toBe(true)
  })
}

/* 🔴 垂直軸的同一條不變量:**內容再長,導覽軌與狀態列都不准跟著捲走。**

   量測過的實況(修前):integrations / trash 的導覽軌位移 **1200px**、
   狀態列跑到 **-520**(捲出畫面外);notifications 位移 107。
   —— UX-1 特地做的「已連線 / 更新時間」信任訊號,在最長的兩頁上根本看不到。

   逐頁自己加 `h-full overflow-y-auto` 已被證實靠不住(七頁裡三頁漏掉),
   故改由 `main` 統一擁有垂直捲動;這組測試守的是那個保證。 */
const LONG_PAGES = [
  "/app/settings/integrations",
  "/app/settings/trash",
  "/app/settings/notifications",
  "/app/settings/permissions",
  "/app/settings/company",
  "/app",
] as const

for (const path of LONG_PAGES) {
  test(`${path}:捲到底,導覽軌與狀態列不動`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 })
    await page.goto(path)
    await page.waitForTimeout(1_200)
    const before = await page.evaluate(() =>
      Math.round((document.querySelector("nav") as HTMLElement).getBoundingClientRect().top),
    )

    await page.mouse.wheel(0, 1_500)
    await page.waitForTimeout(400)

    const after = await page.evaluate(() => {
      const nav = document.querySelector("nav") as HTMLElement
      const root = document.querySelector("div.h-screen") as HTMLElement
      const bar = Array.from(document.querySelectorAll("*")).find(
        (e) => e.textContent?.trim() === "已連線",
      ) as HTMLElement | undefined
      return {
        navTop: Math.round(nav.getBoundingClientRect().top),
        rootScrollTop: Math.round(root.scrollTop),
        barTop: bar === undefined ? null : Math.round(bar.getBoundingClientRect().top),
        winH: window.innerHeight,
      }
    })

    expect(after.navTop).toBe(before) // 導覽軌不位移
    expect(after.rootScrollTop).toBe(0) // app shell 本身不捲
    if (after.barTop !== null) expect(after.barTop).toBeLessThan(after.winH) // 狀態列仍在畫面內
    if (after.barTop !== null) expect(after.barTop).toBeGreaterThan(0)
  })
}
