import { expect, test } from "@playwright/test"

/* R1·UP-3 form-designer-2d UI 固化:2D 畫布 + 欄位設定面板 + 設計草稿/undo + 儲存版面(PUT layout)
   + 靜態元素 + 拖曳重定位。對 dev api + 真 PG;用採購單(form 1,dev DB 有欄位)。 */

test("2D 設計器:畫布 + 欄位設定 + 草稿 undo + 儲存版面", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "文字", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeDisabled()

  // 點欄位卡(供應商=單行文字)→ 設定面板
  await page.locator('div[role="button"]:has-text("供應商")').first().click()
  await expect(page.getByRole("textbox", { name: "提示文字(placeholder)" })).toBeVisible()

  // 設 placeholder → dirty(儲存版面 + 復原 啟用)
  await page.getByRole("textbox", { name: "提示文字(placeholder)" }).fill("暫存值")
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeEnabled()
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeEnabled()

  // 復原 → 回乾淨(儲存版面 disabled)
  await page.getByRole("button", { name: "復原", exact: true }).click()
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeDisabled()

  // 重設 placeholder(唯一值,避免與既存 layout 同值 → 非 dirty)+ 儲存 → PUT layout 成功
  await page.locator('div[role="button"]:has-text("供應商")').first().click()
  await page
    .getByRole("textbox", { name: "提示文字(placeholder)" })
    .fill(`供應商_${Date.now().toString().slice(-5)}`)
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeEnabled()
  await page.getByRole("button", { name: "儲存版面" }).click()
  await expect(page.getByText("版面已儲存")).toBeVisible()
})

test("2D 設計器:加靜態文字元素", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "文字", exact: true }).click()
  // 靜態文字元素設定面板 + dirty
  await expect(page.getByText("文字元素")).toBeVisible()
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeEnabled()
})

test("2D 設計器:拖曳欄位重定位 → dirty", async ({ page }) => {
  await page.goto("/app/builder?form=1")
  await expect(page.getByText("版面設計")).toBeVisible({ timeout: 30_000 })
  const grip = page.getByRole("button", { name: "拖曳 供應商", exact: true })
  const box = await grip.boundingBox()
  if (box === null) throw new Error("no grip bounding box")
  // dnd-kit 需連續 pointermove(單跳 dragTo → delta 0);分步 mouse 移動
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 220, box.y + 8, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole("button", { name: "儲存版面" })).toBeEnabled()
})

/* 🔴 版面屬性必須在**填單頁**生效,不是只在設計畫布看得到。

   出貨以來這三項都是「設了沒反應」:
   - `readonly` 全 repo 零 reader —— 勾了唯讀照樣能改,使用者以為欄位保護住了
   - `help` 只當布林旗標,渲染出一個點不出東西的 `?`(有記號沒內容比沒有記號更糟)
   - `placeholder` 只在設計畫布的預覽出現,真正的輸入框從來沒收到

   三者共同的形態是**設計器承諾了、填單沒兌現**,而畫面上完全看不出來。
   退化時同樣看不出來 —— 所以斷言盯的是「單號沒有 textbox」而不是「畫面正常」。 */
test("版面屬性在填單頁生效:唯讀不給編輯器、說明文字取得到、提示文字進輸入框", async ({
  page,
  request,
}) => {
  const stamp = String(Date.now()).slice(-6)
  const res = await request.post("http://localhost:3001/api/forms", {
    headers: { "x-dev-tenant": "1", "content-type": "application/json" },
    data: {
      name: `版面屬性_${stamp}`,
      fields: [
        { name: "單號", type: "text" },
        { name: "備註", type: "text" },
      ],
    },
  })
  const form = (await res.json()) as { id: number; fields: { id: number; name: string }[] }
  const idOf = (n: string): string => String(form.fields.find((f) => f.name === n)?.id ?? 0)

  await request.patch(`http://localhost:3001/api/forms/${String(form.id)}/layout`, {
    headers: { "x-dev-tenant": "1", "content-type": "application/json" },
    data: {
      grid: { cols: 12 },
      fields: {
        [idOf("單號")]: { row: 0, col: 0, colSpan: 6, readonly: true, help: "由系統自動編號" },
        [idOf("備註")]: { row: 1, col: 0, colSpan: 6, placeholder: "例:急件" },
      },
      statics: [],
      sections: [],
    },
  })

  await page.goto(`/app/builder?form=${String(form.id)}&mode=fill`)
  /* URL 的 mode=fill 不會選到分頁,要真的點 —— 這一點是 MCP 實走時發現的 */
  await page.getByRole("tab", { name: "填單" }).click()
  await expect(page.getByText("填寫", { exact: true })).toBeVisible({ timeout: 30_000 })

  /* 提示文字要真的進到輸入框(它是 textbox 的無障礙名稱來源) */
  await expect(page.getByRole("textbox", { name: "例:急件" })).toBeVisible()

  /* 唯讀欄**根本不渲染編輯器** —— 不是 disabled 屬性,是沒有這個元素。
     刻意如此:readonly 若當成 prop 穿過二十幾個型別分支,漏一支就破功。
     全頁只該有「備註」一個 textbox;「單號」若冒出編輯器,這裡會變成 2。 */
  await expect(page.getByRole("textbox")).toHaveCount(1)

  /* 說明文字要取得到,不能只是一個 `?` */
  await expect(page.getByLabel("說明:由系統自動編號")).toBeVisible()
})
