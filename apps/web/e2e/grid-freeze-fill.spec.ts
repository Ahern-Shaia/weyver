import { expect, test } from "@playwright/test"

/* 🔴 R1·GP v1.1|凍結欄 + 填滿把手(`docs/modules/R1/grid-paste.md` §8)。

   `docs/25` B 段的網格那一列是 R1 **絕對缺口最大的單一列**,而剩的就是這兩項。
   兩者都是 Glide 已經有的能力(`freezeColumns` / `fillHandle` + `onFillPattern`),
   我方零使用 —— 站②的教訓,本模組上次正是在這裡漏查。

   ⚠️ **這兩件事都畫在 canvas 上**,DOM 裡什麼都沒有:
   · 凍結 → 只能捲到最右邊再看前幾欄還在不在
   · 填滿 → Glide 不吃合成事件(實測 `PointerEvent` 選不到格),
     必須用 Playwright 的**真實滑鼠**(CDP input)

   故本檔的斷言一律落在**可觀察的後果**(捲動後的欄位偏移 / 資料真的被改),
   不去戳 canvas 的內部狀態。 */

const DEV = { "x-dev-tenant": "1", "content-type": "application/json" }
const uniq = (): string => String(Date.now()).slice(-6)

/* 座標與 `collection-view` 的欄寬定義同步。
   ⚠️ 改欄寬會讓本檔失準 —— 那時測試會紅,而**紅在這裡比紅在使用者那裡好**。

   ⚠️ **第一版漏了 Glide 自己的列號欄**(`rowMarkers="both"`),於是「填滿把手」
   的座標落在格子中間而不是右下角,拖了什麼都沒發生。canvas 上沒有 DOM 可問,
   只能照著畫面量 —— 量到的值記在這裡,不要憑印象。 */
const GLIDE_MARKER_W = 35 // Glide 的列號 / 勾選欄
const OPEN_COL_W = 52 // 我方的「檢視」前導欄(collection-view `__open__`)
const COL_W = 140 // 一般資料欄
const HEADER_H = 36
const ROW_H = 34
/* 第一個資料欄(品名)的左緣 */
const FIRST_DATA_X = GLIDE_MARKER_W + OPEN_COL_W

async function seed(
  request: import("@playwright/test").APIRequestContext,
  rows: number,
): Promise<{ id: number; name: string }> {
  const res = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E網格_${uniq()}`,
      fields: [
        { name: "品名", type: "text" },
        { name: "規格", type: "text" },
        { name: "單位", type: "text" },
        { name: "數量", type: "number" },
      ],
    },
  })
  const form = (await res.json()) as { id: number; name: string }
  for (let i = 1; i <= rows; i += 1) {
    await request.post(`/api/engine/forms/${String(form.id)}/records`, {
      headers: DEV,
      data: { values: { 品名: `品項${String(i)}`, 規格: "5L", 單位: "箱", 數量: i } },
    })
  }
  return form
}

test("🔴 凍結欄:捲到最右邊,前兩欄仍留在原地", async ({ page, request }) => {
  const form = await seed(request, 3)
  await page.setViewportSize({ width: 620, height: 700 })
  await page.goto(`/app/forms/${String(form.id)}`)

  await page.getByRole("button", { name: "凍結" }).click({ timeout: 30_000 })
  /* 凍結 1 欄:凍結數是**從左邊算起**(含我方的「檢視」前導欄),
     所以 1 就已經把「檢視」釘住。比對範圍取到品名的左緣前為止。 */
  await page.getByLabel("凍結欄數").selectOption("2")

  /* Glide 的橫向捲動掛在 `.dvn-scroller` 上,canvas 本身不捲 */
  const scroller = page.locator(".dvn-scroller")
  await expect(scroller).toBeVisible({ timeout: 15_000 })

  const before = await scroller.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  /* 對照組:內容真的比可視區寬,否則「捲到最右」沒有意義,下面的斷言會空過 */
  expect(before.sw).toBeGreaterThan(before.cw + 100)

  /* 🔴 **只能讀 canvas 的像素**。

     試過而不行的兩條路,記在這裡免得下次重走:
     · `scrollWidth` 不隨 `freezeColumns` 改變(實測 0/2/3 都是 924)—— 沒有幾何訊號
     · `toBuffer().equals()` 全等比對必紅 —— Glide 捲動時會在凍結邊界畫一道陰影,
       那是**對的行為**

     故:直接讀 `getImageData`,比對「捲動前 vs 捲動後」的差異比例,
     並且**同時**檢查右側有變(否則捲動根本沒發生,左側自然一樣 → 空過)。 */
  const diff = await page.evaluate(
    async ([frozenCss, colCss]) => {
      const canvas = document.querySelector("canvas")
      const scroll = document.querySelector(".dvn-scroller")
      if (canvas === null || scroll === null) throw new Error("no grid")
      const ctx = canvas.getContext("2d")
      if (ctx === null) throw new Error("no 2d")
      /* canvas 的實際像素是 CSS 尺寸 × devicePixelRatio */
      const ratio = canvas.width / canvas.getBoundingClientRect().width
      const grab = (xCss: number, wCss: number): Uint8ClampedArray =>
        ctx.getImageData(
          Math.round(xCss * ratio),
          0,
          Math.round(wCss * ratio),
          Math.round(120 * ratio),
        ).data
      const ratioOf = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
        let n = 0
        for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) n += 1
        return n / (a.length / 4)
      }
      const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 500))

      scroll.scrollLeft = 0
      await wait()
      const frozenAtZero = grab(0, frozenCss)
      const rightAtZero = grab(frozenCss + 10, colCss)

      scroll.scrollLeft = scroll.scrollWidth
      await wait()
      return {
        frozen: ratioOf(frozenAtZero, grab(0, frozenCss)),
        right: ratioOf(rightAtZero, grab(frozenCss + 10, colCss)),
      }
    },
    [GLIDE_MARKER_W + OPEN_COL_W + COL_W - 12, COL_W - 20] as const,
  )

  /* 對照組:右側真的換了內容(捲動確實發生)。
     ⚠️ 門檻**不能憑感覺設**:實測右側只差 ~2.4%,因為取樣區大多是空白格底,
     文字只佔一小部分像素。第一版設 5% 直接紅在對照組上 —— 而功能是好的。 */
  expect(diff.right).toBeGreaterThan(0.01)
  /* 🔴 **相對**斷言而不是絕對門檻:凍結區的變動要遠小於右側。
     這樣不必為「文字佔多少像素」調參,換了字型或欄寬也不會假紅。 */
  expect(diff.frozen).toBeLessThan(diff.right / 3)
})

/* 🔴 填滿把手。**它不是第二條寫入路徑,它就是貼上** —— 平鋪後餵給同一支 `onPaste`,
   於是計算欄跳過 / 型別先驗 / 一步 undo 全部自動成立(OQ-GF-5)。 */
test("🔴 填滿把手:往下拖 → 下面幾列被填成來源值", async ({ page, request }) => {
  const form = await seed(request, 3)
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto(`/app/forms/${String(form.id)}`)

  const canvas = page.locator("canvas").first()
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  const box = await canvas.boundingBox()
  if (box === null) throw new Error("no canvas")

  /* 「品名」是第一個資料欄 → x 落在 marker 之後的半欄處 */
  const cellX = box.x + FIRST_DATA_X + COL_W / 2
  const rowY = (i: number): number => box.y + HEADER_H + ROW_H * i + ROW_H / 2

  /* 真實滑鼠:Glide 不吃合成事件(實測過) */
  await page.mouse.click(cellX, rowY(0))
  await page.waitForTimeout(300)

  /* 填滿把手在選取格的右下角。抓住它往下拖兩列。 */
  const handleX = box.x + FIRST_DATA_X + COL_W - 2
  const handleY = box.y + HEADER_H + ROW_H - 2
  await page.mouse.move(handleX, handleY)
  await page.mouse.down()
  await page.mouse.move(handleX, rowY(2), { steps: 8 })
  await page.mouse.up()

  /* 寫入是非同步的(走批次端點),等資料而不是等動畫 */
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/engine/forms/${String(form.id)}/records`, {
          headers: DEV,
        })
        const body = (await res.json()) as { records: { values: Record<string, unknown> }[] }
        return body.records.map((r) => String(r.values.品名))
      },
      { timeout: 20_000 },
    )
    .toEqual(["品項1", "品項1", "品項1"])
})
