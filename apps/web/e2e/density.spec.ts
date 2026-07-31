import { expect, test } from "@playwright/test"

/* R1·UX-1 M10|**FMEA U11(P0)之常設守衛**:字階收斂不得減少單螢幕可見列數。

   SAP Fiori 官方明載 compact 模式**字級不變,只縮元件尺寸與間距** —— 即
   **密度靠間距不靠縮字**。M10 把字級由 16 種收斂為 6 階(地板 12px)後,
   記錄清單列高一度由 55→57px、可見列數 14→13(U11 實際發生);
   依 Fiori 原則以間距回收(py-2→py-1.5、mt-1→mt-0.5)後為 51px / 15 列。

   本測試釘住上限,避免日後有人「順手」加大 padding 或字級而悄悄降低密度。 */

const DEV = { "x-dev-tenant": "1", "x-dev-actor": "1" }

/* 上限取 55px = M10 改動**前**的列高 —— 即「不得比收斂前更鬆」。 */
const MAX_ROW_HEIGHT = 55
const MIN_VISIBLE_ROWS = 14

test("記錄清單:列高與可見列數不得比字階收斂前更差", async ({ page, request }) => {
  const tag = Date.now().toString().slice(-6)
  const f = await request.post("/api/engine/forms", {
    headers: DEV,
    data: {
      name: `E2E密度_${tag}`,
      fields: [
        { name: "品名", type: "text" },
        { name: "數量", type: "number" },
      ],
    },
  })
  expect(f.status()).toBe(201)
  const formId = (await f.json()).id as number
  for (let i = 0; i < 25; i += 1) {
    await request.post(`/api/engine/forms/${String(formId)}/records`, {
      headers: DEV,
      data: { values: { 品名: `項目${String(i)}`, 數量: i } },
    })
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/app/forms/${String(formId)}?mode=record`)
  const listbox = page.getByRole("listbox", { name: "記錄清單" })
  await expect(listbox).toBeVisible({ timeout: 30_000 })
  await expect(listbox.getByRole("option").first()).toBeVisible({ timeout: 30_000 })

  const m = await page.evaluate(() => {
    const box = document.querySelector('[role="listbox"]')
    if (!box) return { rowHeight: 0, visibleRows: 0 }
    const first = box.querySelector('[role="option"]')
    const h = first ? first.getBoundingClientRect().height : 0
    return {
      rowHeight: Math.round(h),
      visibleRows: h > 0 ? Math.floor(box.getBoundingClientRect().height / h) : 0,
    }
  })

  expect(m.rowHeight, `列高 ${String(m.rowHeight)}px 超過上限 —— 密度應靠間距回收,不得放寬`).
    toBeLessThanOrEqual(MAX_ROW_HEIGHT)
  expect(m.visibleRows, `可見列數 ${String(m.visibleRows)} 低於下限`).
    toBeGreaterThanOrEqual(MIN_VISIBLE_ROWS)
})
