import { describe, expect, it } from "vitest"
import { PASTE_MAX_ROWS, describePasteRejection, normalizePasteMatrix } from "./paste-matrix"

/* 這些輸入是 @glideapps/glide-data-grid@6.0.3 的 `unquote()` 對真實剪貼簿字串的**實際輸出**
   (2026-08-03 以 node 直接呼叫該函式取得),不是臆造的形狀。
   例:`"a\tb\r\n"`(Excel 複製一列會帶尾端換行)→ `[["a","b"],[]]` */

describe("normalizePasteMatrix", () => {
  it("砍掉 Excel 尾端換行造成的空列 —— 否則「貼 2 列」會變成「將新增 1 列」的幽靈提示", () => {
    const r = normalizePasteMatrix([["a", "b"], []])
    expect(r.ok && r.matrix.rows).toEqual([["a", "b"]])
  })

  it("儲存格內的換行由上游解析,本層原樣保留", () => {
    const r = normalizePasteMatrix([["a\nb", "c"]])
    expect(r.ok && r.matrix.rows).toEqual([["a\nb", "c"]])
  })

  it("中間的空格不是空列,不得被當成結尾", () => {
    const r = normalizePasteMatrix([
      ["a", "", "b"],
      ["", "", ""],
      ["c", "d", "e"],
    ])
    expect(r.ok && r.matrix.rows).toHaveLength(3)
  })

  it("鋸齒狀補成矩形 —— 錯誤格標示以 (row, col) 定位,少一格就會對錯欄", () => {
    const r = normalizePasteMatrix([["a", "b", "c"], ["d"]])
    expect(r.ok && r.matrix).toEqual({
      cols: 3,
      rows: [
        ["a", "b", "c"],
        ["d", "", ""],
      ],
    })
  })

  it("全空視為沒東西可貼", () => {
    expect(normalizePasteMatrix([[""], [""]])).toEqual({ ok: false, reason: "empty" })
    expect(normalizePasteMatrix([])).toEqual({ ok: false, reason: "empty" })
  })

  it("超過上限明確拒絕並回報實際列數 —— 不靜默截斷(OQ-GP-2)", () => {
    const rows = Array.from({ length: PASTE_MAX_ROWS + 3 }, (_, i) => [String(i)])
    const r = normalizePasteMatrix(rows)
    expect(r).toEqual({ ok: false, reason: "tooManyRows", rowCount: PASTE_MAX_ROWS + 3 })
    expect(describePasteRejection(r)).toContain(String(PASTE_MAX_ROWS + 3))
  })

  it("恰好等於上限要放行(邊界別差一)", () => {
    const rows = Array.from({ length: PASTE_MAX_ROWS }, (_, i) => [String(i)])
    expect(normalizePasteMatrix(rows).ok).toBe(true)
  })

  /* 🔴 上游已知缺陷:`unquote` 逐碼點迭代卻以碼元 slice,含 astral 字元就整塊位移。
     `"🙂\tB\nC\tD"` 實測解析成下方這團東西 —— 若原樣寫入,使用者看到「貼上成功」
     但值是壞的,正是 §0.3(c) 四家共同的反面教材。 */
  it("上游解析位移(落單代理碼元)整塊拒絕,不寫入壞值", () => {
    const r = normalizePasteMatrix([
      ["\ud83d", "\t"],
      ["\n", "\tD"],
    ])
    expect(r).toEqual({ ok: false, reason: "corrupt" })
    expect(describePasteRejection(r)).toContain("表情符號")
  })

  it("成對的代理碼元是正常字元,不得誤擋", () => {
    const r = normalizePasteMatrix([["🙂", "B"]])
    expect(r.ok).toBe(true)
  })

  it("通過時沒有拒絕訊息", () => {
    expect(describePasteRejection(normalizePasteMatrix([["a"]]))).toBeNull()
  })
})
