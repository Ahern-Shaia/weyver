import { expect, test } from "@playwright/test"

/* R1·UP-5 M1|殼的不變量量測基線(docs/29 §3 的 S1 / S3 / S4 / S5)。

   **為什麼是棘輪而不是硬門檻**|三個面裡有兩個現在就不合格(見 BASE)。
   一次要求達標 = 測試第一天就紅,而紅了沒人修的測試等於沒有測試
   (與 `packages/docs-check/src/research-required.test.ts` 同一處置)。
   重構每完成一步就把 BASE 往下調,**只能變好不能變壞**。

   ⚠️ **S1 的比率跨面不可比,這是量出來的**|
   工作區首頁 1021 個可見元素 vs 表單工作面 **95 個** ——
   差距不是因為首頁複雜,是因為**列表的主體是 Glide canvas**(整張表一個 `<canvas>`)。
   分母只剩殼,比率自然衝高。所以 BASE 是**逐面**的,沒有全域 6%。

   ⚠️ **S2(層級靠面不靠線)沒有機器判準,本檔不假裝有** ——
   「相鄰區塊以底色階差區分」需要語意判斷,硬做一個代理指標只會產生假訊號
   (本 repo 今天已為「代理指標的輸出不是答案」付過三次代價)。 */

interface Baseline {
  readonly url: string
  /** S1 邊框佔比上限(%)。 */
  readonly s1: number
  /** S5 水平 header 帶數上限。 */
  readonly s5: number
  /** 🔴 該面「渲染完成」的可觀察訊號 —— 不可用固定 timeout(見下)。 */
  readonly ready: string
}

/* 2026-08-08 實測。🔴 設計器的 19.6% 與 docs/29 §3 自己記的數字**完全相同** ——
   那是判準實作正確的獨立驗證(該文逐字:「現行設計器由 19.6% 變成 3.3%」)。 */
const BASE: Record<string, Baseline> = {
  工作區首頁: { url: "/app", s1: 1.0, s5: 3, ready: "待我簽核" },
  表單工作面: { url: "/app/forms/1?mode=list", s1: 21.0, s5: 3, ready: "＋ 小圖表" },
  表單設計器: { url: "/app/builder?form=1", s1: 19.8, s5: 3, ready: "版面設計" },
}

/* 判準逐字照 docs/29 §3:可見元素中帶 border 者的比例,**只排除兩類** ——
   (a) 單據語言的欄位表 / table (b) input / select / textarea。**按鈕一律計入。**
   該文記著這條判準怎麼定錯又修正:順手排除 button 會讓設計器由 19.6% 變 3.3%
   「直接合格」,而那正是 review 兩次指出有問題的畫面。 */
async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const visible = [...document.querySelectorAll("body *")].filter((e) => {
      const b = e.getBoundingClientRect()
      return (
        b.width > 2 &&
        b.height > 2 &&
        getComputedStyle(e).visibility !== "hidden" &&
        e.closest("nextjs-portal") === null
      )
    })
    const pool = visible.filter(
      (e) =>
        !["INPUT", "SELECT", "TEXTAREA"].includes(e.tagName) &&
        e.closest("table, [data-field-grid]") === null,
    )
    const bordered = pool.filter((e) => {
      const cs = getComputedStyle(e)
      return (["Top", "Right", "Bottom", "Left"] as const).some((side) => {
        const w = Number.parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`))
        const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`)
        const color = cs.getPropertyValue(`border-${side.toLowerCase()}-color`)
        return w > 0 && style !== "none" && !/rgba\(0, 0, 0, 0\)|transparent/.test(color)
      })
    })
    const buttons = bordered.filter((e) => e.tagName === "BUTTON").length
    /* S5|水平 header 帶:寬 > 視窗 55%、高 24–80px、貼在上緣 170px 內。

       🔴 **第一版的偵測器錯了兩處,是去看它抓到什麼才發現的**:
       ① 把 Glide 網格的 `<canvas>`(h=37,貼在工具列下)當成一條帶
       ② 同一條帶的**外層與內層 div 各算一次**(top=44 h=37 與 top=44 h=36)
       於是列表頁量到 5 條,真實是 3 條(頁籤 / 檢視工具列 / 小圖表)。
       ⚠️ 當時我的基線猜 3 —— **猜對了、偵測器錯了**。
       若當初直接把基線調成 5,就等於把壞掉的偵測器制度化。 */
    const raw = visible.filter((e) => {
      if (["CANVAS", "SVG", "IMG"].includes(e.tagName)) return false
      const b = e.getBoundingClientRect()
      return (
        b.width > window.innerWidth * 0.55 &&
        b.height >= 24 &&
        b.height <= 80 &&
        b.top >= 0 &&
        b.top < 170
      )
    })
    /* 巢狀去重:祖先也是候選時只留最外層 */
    const bands = raw.filter((e) => !raw.some((o) => o !== e && o.contains(e)))
    return {
      visible: visible.length,
      pool: pool.length,
      bordered: bordered.length,
      buttons,
      s1: Number(((bordered.length / Math.max(1, pool.length)) * 100).toFixed(1)),
      s5: bands.length,
    }
  })
}

/* 🔴 **釘視窗** —— 基線量測不釘視窗等於沒有基線。
   實測:同一份 DOM(設計器 1128 個可見元素,兩次完全相同)在不同寬度下
   S5 量到 3 與 1 —— 窄視窗把工具列擠到 170px 以下,帶就「不見了」。
   數字沒有變壞,是**量尺變了**。 */
test.use({ viewport: { width: 1720, height: 1050 } })

for (const [name, base] of Object.entries(BASE)) {
  test(`殼的不變量|${name} 不得比基線更差`, async ({ page }) => {
    await page.goto(base.url)
    /* 🔴 等**該面自己的就緒訊號**,不是等固定時間。
       第一版用 `main` 可見 + 1200ms,設計器量到 S5=1(真實 3)——
       量到的是還沒渲染完的畫面,而它**看起來像個合格的數字**。
       固定等待在量測型測試裡特別危險:它不會 flake 成紅,它會 flake 成**假的綠**。 */
    await expect(page.getByText(base.ready, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    })

    const m = await measure(page)
    // biome-ignore lint/suspicious/noConsole: 基線量測的輸出就是這個測試的產物
    console.log(
      `[殼] ${name} S1=${m.s1}% (${m.bordered}/${m.pool}，其中按鈕 ${m.buttons}) S5=${m.s5}`,
    )

    expect(m.pool, "可見元素為 0 = 頁面沒載起來，量到的數字沒有意義").toBeGreaterThan(20)
    expect(m.s1, `S1 邊框佔比不得高於基線 ${base.s1}%`).toBeLessThanOrEqual(base.s1)
    expect(m.s5, `S5 水平 header 帶不得多於基線 ${base.s5} 條`).toBeLessThanOrEqual(base.s5)
  })
}
