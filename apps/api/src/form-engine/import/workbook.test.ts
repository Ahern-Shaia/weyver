import { describe, expect, it } from "vitest"
import { utils, write } from "xlsx"
import { MAX_IMPORT_ROWS, parseSheet, sheetNames, suggestMapping } from "./workbook.js"

/* 🔴 OQ-IMP-6:解析移到後端(推翻既有的前端解析裁定)。
   Airtable 的 25,000 列上限正是前端解析的代價;瀏覽器端會撞 V8 字串長度上限。 */

function book(sheets: Record<string, unknown[][]>): Buffer {
  const wb = utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) {
    utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), name)
  }
  return write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

describe("後端解析活頁簿(#106 M3)", () => {
  it("讀得到全部工作表名稱,且可指定要解析哪一張", () => {
    const buf = book({
      使用說明: [["請勿修改本表"]],
      客戶資料: [
        ["客戶編號", "客戶名稱"],
        ["A001", "王先生"],
      ],
    })
    expect(sheetNames(buf)).toEqual(["使用說明", "客戶資料"])

    const parsed = parseSheet(buf, "客戶資料")
    expect(parsed.columns).toEqual(["客戶編號", "客戶名稱"])
    expect(parsed.rows).toEqual([{ 客戶編號: "A001", 客戶名稱: "王先生" }])
  })

  it("**標題不在第一列時仍找得到** —— 舊 Excel 前幾列常是公司抬頭", () => {
    const buf = book({
      Sheet1: [["鮮勇食品股份有限公司"], [], ["品項", "數量"], ["雞胸肉", "10"]],
    })
    const parsed = parseSheet(buf)
    expect(parsed.columns).toEqual(["品項", "數量"])
    expect(parsed.headerRowIndex).toBe(3)
    expect(parsed.rows).toEqual([{ 品項: "雞胸肉", 數量: "10" }])
  })

  it("空白列不混進資料;重複欄名自動加序號", () => {
    const buf = book({
      Sheet1: [["品項", "品項"], ["甲", "乙"], [], ["丙", "丁"]],
    })
    const parsed = parseSheet(buf)
    expect(parsed.columns).toEqual(["品項", "品項_2"])
    expect(parsed.rows).toHaveLength(2)
  })

  it("**超過上限要明示截斷** —— 靜默截斷是英國 PHE 15,841 筆確診遺失的同款失效", () => {
    const rows: unknown[][] = [["編號"]]
    for (let i = 0; i < MAX_IMPORT_ROWS + 10; i++) rows.push([`A${String(i)}`])
    const parsed = parseSheet(book({ Sheet1: rows }))
    expect(parsed.truncated).toBe(true)
    expect(parsed.totalRows).toBe(MAX_IMPORT_ROWS + 10)
    expect(parsed.rows).toHaveLength(MAX_IMPORT_ROWS)
  })

  it("找不到指定工作表 → 明確報錯,不默默拿第一張", () => {
    expect(() => parseSheet(book({ Sheet1: [["a"]] }), "不存在")).toThrow()
  })
})

describe("對映建議:只做完全相符(#106)", () => {
  it("欄名完全相符(去空白、不分大小寫)才配對", () => {
    const out = suggestMapping(
      ["客戶編號", " 客戶名稱 ", "Email"],
      ["客戶編號", "客戶名稱", "email"],
    )
    expect(out).toEqual({ 客戶編號: "客戶編號", " 客戶名稱 ": "客戶名稱", Email: "email" })
  })

  it("**近似但不相同的欄名不自動配** —— 誤配比未配更貴,使用者不會發現", () => {
    expect(suggestMapping(["客戶電話"], ["客戶編號"])).toEqual({})
    expect(suggestMapping(["客戶編號2"], ["客戶編號"])).toEqual({})
  })

  it("同一個表單欄位不會被配給兩個來源欄", () => {
    const out = suggestMapping(["編號", "編號"], ["編號"])
    expect(Object.values(out)).toEqual(["編號"])
  })
})

describe("🔴 預設工作表(瀏覽器實走時發現,#106)", () => {
  it("**預設取資料最多的那張,不是第一張** —— 客戶檔案常把「使用說明」放前面", () => {
    const buf = book({
      使用說明: [["請勿修改本表"]],
      客戶資料: [
        ["客戶編號", "客戶名稱"],
        ["A001", "王先生"],
        ["A002", "李小姐"],
      ],
    })
    const parsed = parseSheet(buf)
    expect(parsed.sheetName).toBe("客戶資料")
    expect(parsed.rows).toHaveLength(2)
  })

  it("顯式指定工作表時不受影響", () => {
    const buf = book({
      說明: [["a"], ["b"]],
      資料: [["欄"], ["1"], ["2"], ["3"]],
    })
    expect(parseSheet(buf, "說明").sheetName).toBe("說明")
  })
})

/* 🔴 合併儲存格(#106):值只在左上角,其餘是空的 → 直接匯入會靜默產生空白欄位。
   舊 Excel 的單頭欄(訂單編號跨多列明細)幾乎必然是合併的。 */
describe("合併儲存格", () => {
  it("以左上角的值填滿整個合併範圍,並回報數量", () => {
    const ws = utils.aoa_to_sheet([
      ["訂單編號", "品項"],
      ["PO-001", "螺絲"],
      ["", "螺帽"],
      ["", "墊片"],
    ])
    ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }]
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, "工作表1")
    const buf = write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer

    const parsed = parseSheet(buf)
    expect(parsed.mergedCells).toBe(2)
    expect(parsed.rows.map((r) => r.訂單編號)).toEqual(["PO-001", "PO-001", "PO-001"])
  })

  it("沒有合併時 mergedCells 為 0(不誤報)", () => {
    const ws = utils.aoa_to_sheet([
      ["A", "B"],
      ["1", "2"],
    ])
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, "s")
    const buf = write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
    expect(parseSheet(buf).mergedCells).toBe(0)
  })
})
