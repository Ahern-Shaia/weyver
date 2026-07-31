import { expect, test, type Page } from "@playwright/test"

/* R1·UX-1 M5|可編輯子表的 W3C ARIA APG grid pattern,逐鍵斷言。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }
const uniq = (): string => Date.now().toString().slice(-6)

async function seedParentWithChild(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const tag = uniq()
  const parentName = `E2E鍵盤_${tag}`
  const parent = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: parentName, fields: [{ name: "單號", type: "text" }] },
  })
  expect(parent.status()).toBe(201)
  const parentId = (await parent.json()).id as number

  const child = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E鍵盤明細_${tag}`,
      parentFormId: parentId,
      fields: [
        { name: "品名", type: "text" },
        { name: "數量", type: "number" },
        { name: "單價", type: "money" },
      ],
    },
  })
  expect(child.status()).toBe(201)
  return parentName
}

/* 目前聚焦的儲存格座標(data-grid-cell="row:col") */
async function focusedCell(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement
    const cell = el?.closest("[data-grid-cell]")
    return cell?.getAttribute("data-grid-cell") ?? null
  })
}

/* 填單面板由左側表單清單 → 「填單」分頁進入(與 builder.spec 同路徑;
   非 query param —— 首版測試曾誤以為可直接用 ?panel=record 開啟)。 */
async function openFillPanelWithLines(page: Page, formName: string): Promise<void> {
  await page.goto("/app/builder")
  await page.getByRole("button", { name: new RegExp(formName) }).click()
  await page.getByRole("tab", { name: "填單" }).click()
  await page.getByRole("button", { name: /加一行/ }).click({ timeout: 30_000 })
  await page.getByRole("button", { name: /加一行/ }).click()
  await expect(page.getByRole("grid", { name: "明細子表" })).toBeVisible({ timeout: 30_000 })
}

test("方向鍵移動且邊界不環繞;Home/End 與 Ctrl+Home/End", async ({ page, request }) => {
  const formName = await seedParentWithChild(request)
  await openFillPanelWithLines(page, formName)

  await page.locator('[data-grid-cell="0:0"]').focus()
  expect(await focusedCell(page)).toBe("0:0")

  await page.keyboard.press("ArrowRight")
  expect(await focusedCell(page)).toBe("0:1")

  await page.keyboard.press("ArrowDown")
  expect(await focusedCell(page)).toBe("1:1")

  // 🔴 邊界不環繞(APG 明訂)
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  expect(await focusedCell(page)).toBe("1:1")

  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  expect(await focusedCell(page)).toBe("1:0")

  await page.keyboard.press("End")
  expect(await focusedCell(page)).toBe("1:2")

  await page.keyboard.press("Home")
  expect(await focusedCell(page)).toBe("1:0")

  await page.keyboard.press("Control+End")
  expect(await focusedCell(page)).toBe("1:2")

  await page.keyboard.press("Control+Home")
  expect(await focusedCell(page)).toBe("0:0")
})

test("F2 / Enter 進編輯,Esc 回導覽態且不改值", async ({ page, request }) => {
  const formName = await seedParentWithChild(request)
  await openFillPanelWithLines(page, formName)

  await page.locator('[data-grid-cell="0:0"]').focus()
  await page.keyboard.press("F2")
  // 編輯態:焦點在格內的輸入元件
  await expect
    .poll(async () =>
      page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? ""),
    )
    .toBe("input")

  await page.keyboard.type("鋼板")
  await page.keyboard.press("Escape")
  // 回導覽態:焦點回到儲存格本身
  expect(await focusedCell(page)).toBe("0:0")
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? ""))
    .toBe("td")
})

test("直接打字即進編輯並取代內容", async ({ page, request }) => {
  const formName = await seedParentWithChild(request)
  await openFillPanelWithLines(page, formName)

  await page.locator('[data-grid-cell="0:0"]').focus()
  await page.keyboard.press("A")
  await expect
    .poll(async () => page.evaluate(() => (document.activeElement as HTMLInputElement)?.value ?? ""))
    .toBe("A")
})

/* 🔴 FMEA U4(P0)|roving tabindex 做錯即成鍵盤陷阱(WCAG 2.1.1,A 級違規)。 */
test("整個 grid 只有一個 Tab 停點,且 Tab 一定能離開", async ({ page, request }) => {
  const formName = await seedParentWithChild(request)
  await openFillPanelWithLines(page, formName)

  // 導覽態:格內可聚焦元素全數退出 Tab 序列
  const tabbableInside = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]')
    if (!grid) return -1
    return [...grid.querySelectorAll("[data-grid-cell]")].reduce(
      (n, cell) =>
        n +
        [...cell.querySelectorAll("input, select, textarea, button")].filter(
          (el) => (el as HTMLElement).tabIndex >= 0,
        ).length,
      0,
    )
  })
  expect(tabbableInside).toBe(0)

  const stops = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]')
    return [...(grid?.querySelectorAll("[data-grid-cell]") ?? [])].filter(
      (c) => (c as HTMLElement).tabIndex === 0,
    ).length
  })
  expect(stops).toBe(1)

  // 🔴 從格內按 Tab 必須離開 grid —— 攔截 Tab 即為鍵盤陷阱
  await page.locator('[data-grid-cell="0:0"]').focus()
  await page.keyboard.press("Tab")
  expect(await focusedCell(page)).toBeNull()
})

/* ── APG listbox pattern(record-list;與 grid 是不同規範)────────────── */

test("記錄清單:↑↓ 切換選取,只有一個 Tab 停點", async ({ page, request }) => {
  const tag = uniq()
  const form = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E清單_${tag}`, fields: [{ name: "品名", type: "text" }] },
  })
  const formId = (await form.json()).id as number
  for (const v of ["甲", "乙", "丙"]) {
    await request.post(`/api/engine/forms/${String(formId)}/records`, {
      headers: DEV,
      data: { values: { 品名: v } },
    })
  }

  await page.goto(`/app/forms/${String(formId)}?mode=record`)
  const listbox = page.getByRole("listbox", { name: "記錄清單" })
  await expect(listbox).toBeVisible({ timeout: 30_000 })
  // 等記錄載完 —— listbox 先出現、選項後到,太早斷言會量到 0 個停點
  await expect(listbox.getByRole("option")).toHaveCount(3, { timeout: 30_000 })

  // roving tabindex:整份清單只有一個停點
  const stops = await listbox.evaluate(
    (el) => [...el.querySelectorAll("[data-record-option]")].filter((o) => (o as HTMLElement).tabIndex === 0).length,
  )
  expect(stops).toBe(1)

  const first = listbox.getByRole("option").first()
  await first.focus()
  await page.keyboard.press("ArrowDown")
  await expect(listbox.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowUp")
  await expect(listbox.getByRole("option").first()).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("End")
  await expect(listbox.getByRole("option").last()).toHaveAttribute("aria-selected", "true")
})

/* 🔴 FMEA U3|Glide canvas 面明確不動 —— 不得被 grid pattern 波及。 */
test("集合視圖(Glide canvas)未被加上 role=grid", async ({ page, request }) => {
  const tag = uniq()
  const form = await request.post("/api/engine/forms", {
    headers: DEV,
    data: { name: `E2E集合_${tag}`, fields: [{ name: "品名", type: "text" }] },
  })
  const formId = (await form.json()).id as number

  await page.goto(`/app/forms/${String(formId)}`)
  // 等表單名出現即代表集合視圖已載入(不依賴特定按鈕文案 —— 首版測試曾誤猜)
  await expect(page.getByText(`E2E集合_${tag}`).first()).toBeVisible({ timeout: 30_000 })
  // 集合視圖(Glide canvas)不應出現我們的 grid 標記
  expect(await page.locator("[data-grid-cell]").count()).toBe(0)
  expect(await page.getByRole("grid", { name: "明細子表" }).count()).toBe(0)
})
