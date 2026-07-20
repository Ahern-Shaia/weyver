import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { utils, write } from "xlsx"

/* GEI 固化(= P0-2 UI 路徑,承 MCP 走通):匯入 Excel → 型別推斷預覽 → 建表 →
   網格顯示資料 → 改一格(canvas overlay)→「資料」DOM 表格驗證改值落庫。
   dev DB 有狀態 → 表單名帶唯一後綴避免 (tenant,name) 撞名,可重跑。 */

const uniq = () => Date.now().toString().slice(-6)
const FIXTURE = join(tmpdir(), "weyver-e2e-import.xlsx")

test.beforeAll(() => {
  const rows = [
    ["品名", "數量", "單價", "分類", "有機"],
    ["高麗菜", 100, 12.5, "蔬菜", "是"],
    ["白蘿蔔", 250, 8, "蔬菜", "否"],
    ["蘋果", 60, 35.9, "水果", "是"],
    ["香蕉", 120, 18, "水果", "否"],
    ["菠菜", 40, 22.5, "蔬菜", "是"],
    ["橘子", 200, 15, "水果", "否"],
  ]
  const ws = utils.aoa_to_sheet(rows)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, "進貨清單")
  writeFileSync(FIXTURE, write(wb, { type: "buffer", bookType: "xlsx" }))
})

test("匯入 Excel → 推斷預覽 → 建表 → 網格改格 → 資料驗證", async ({ page }) => {
  const formName = `E2E匯入_${uniq()}`

  await page.goto("/app/builder")

  // 1) 開匯入面板、選檔(隱藏 input 直接設檔);表單軌與空狀態各有一顆匯入鈕,取第一顆(軌上)
  await page.getByRole("button", { name: "匯入 Excel" }).first().click()
  await page.locator('input[type="file"]').setInputFiles(FIXTURE)

  // 2) 解析 + 型別推斷預覽出現
  await expect(page.getByText(/欄位對映/)).toBeVisible()
  await expect(page.getByText(/資料預覽/)).toBeVisible()

  // 3) 命名並建立;bulk 灌 6 列
  await page.getByRole("textbox", { name: "表單名稱" }).fill(formName)
  await page.getByRole("button", { name: /建立並匯入/ }).click()

  // 4) 導到新表單 → 網格模式 → 6 筆
  await expect(page.getByRole("tab", { name: "網格" })).toBeVisible()
  await page.getByRole("tab", { name: "網格" }).click()
  await expect(page.getByText(/6 筆/)).toBeVisible()

  // 5) 改第一列品名(canvas cell → overlay 編輯器)
  const canvas = page.locator("canvas").first()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (box === null) throw new Error("grid canvas 無 bounding box")
  await page.mouse.dblclick(box.x + 110, box.y + 53) // row-marker + 半個品名欄寬、header + 半列高
  const editor = page.locator("#portal input, #portal textarea").first() // Glide overlay 掛在 #portal
  await editor.waitFor()
  await editor.fill("高麗菜E2E")
  await page.keyboard.press("Enter")

  // 6)「資料」DOM 表格驗證改值已落庫(canvas 值讀不到 → 走 FDU 表格)
  await page.getByRole("tab", { name: "資料" }).click()
  await expect(page.getByRole("row").filter({ hasText: "高麗菜E2E" }).first()).toBeVisible()
})
