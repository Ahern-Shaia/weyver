import { describe, expect, it } from "vitest"
import { utils, write } from "xlsx"
import { parseSheet, readWorkbook } from "@/app/app/builder/_components/excel/parse"

/* 🔴 追溯稽核 #106|原本寫死首工作表 + 寫死第一列當標題。
   客戶的舊 Excel 幾乎必有「說明 / 範本」前置表,或前幾列是公司抬頭 ——
   兩者都會**靜默吃到錯的資料**,而使用者只會覺得「這軟體壞了」。 */

function book(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) {
    utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), name)
  }
  const out = write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer
  return out
}

describe("🔴 工作表選擇(追溯稽核 #106)", () => {
  it("讀得到全部工作表名稱(原本只看得到第一張)", async () => {
    const data = book({
      使用說明: [["請勿修改本表"]],
      客戶資料: [
        ["客戶名稱", "電話"],
        ["王先生", "0912345678"],
      ],
    })
    expect((await readWorkbook(data)).sheetNames).toEqual(["使用說明", "客戶資料"])
  })

  it("**可指定工作表** —— 否則說明頁會被當成資料匯進來", async () => {
    const data = book({
      使用說明: [["請勿修改本表"]],
      客戶資料: [
        ["客戶名稱", "電話"],
        ["王先生", "0912345678"],
      ],
    })
    const parsed = await parseSheet(data, "客戶資料")
    expect(parsed.columns).toEqual(["客戶名稱", "電話"])
    expect(parsed.rows).toEqual([["王先生", "0912345678"]])
  })
})

describe("🔴 標題列偵測(追溯稽核 #106)", () => {
  it("**標題不在第一列時仍找得到** —— 原本寫死 matrix[0],整份資料會錯位", async () => {
    const data = book({
      Sheet1: [
        ["鮮勇食品股份有限公司"],
        [],
        ["品項", "數量", "單價"],
        ["雞胸肉", "10", "120"],
        ["豬里肌", "5", "180"],
      ],
    })
    const parsed = await parseSheet(data)
    expect(parsed.columns).toEqual(["品項", "數量", "單價"])
    expect(parsed.headerRowIndex).toBe(3)
    expect(parsed.rows).toEqual([
      ["雞胸肉", "10", "120"],
      ["豬里肌", "5", "180"],
    ])
  })

  it("標題本來就在第一列時不受影響", async () => {
    const data = book({
      Sheet1: [
        ["品項", "數量"],
        ["雞胸肉", "10"],
      ],
    })
    const parsed = await parseSheet(data)
    expect(parsed.columns).toEqual(["品項", "數量"])
    expect(parsed.headerRowIndex).toBe(1)
  })

  it("全數字的列不會被誤判成標題", async () => {
    const data = book({
      Sheet1: [
        ["編號", "數量"],
        ["1", "100"],
        ["2", "200"],
      ],
    })
    expect((await parseSheet(data)).columns).toEqual(["編號", "數量"])
  })

  it("空白列不會混進資料(且不影響標題列號)", async () => {
    const data = book({
      Sheet1: [["品項"], ["雞胸肉"], [], ["豬里肌"], []],
    })
    const parsed = await parseSheet(data)
    expect(parsed.rows).toEqual([["雞胸肉"], ["豬里肌"]])
  })
})
