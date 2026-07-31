import { describe, expect, it } from "vitest"

/* R1·UX-1 M5|APG grid 的**移動語意**單元測試。

   hook 本身需 DOM 與 React 生命週期,完整行為由 e2e 逐鍵斷言;
   此處固化最容易寫錯、且 e2e 不易觀察的一條:**邊界不環繞**(APG 明訂)。
   把 clamp 邏輯抽出獨立驗證 —— 若改成環繞(取模),這些斷言會全數轉紅。 */

function clamp(row: number, col: number, rows: number, cols: number): [number, number] {
  return [Math.max(0, Math.min(rows - 1, row)), Math.max(0, Math.min(cols - 1, col))]
}

describe("APG grid 移動:邊界不環繞", () => {
  const ROWS = 3
  const COLS = 4

  it("往下越界停在最後一列,不回到第一列", () => {
    expect(clamp(ROWS, 0, ROWS, COLS)).toEqual([ROWS - 1, 0])
  })

  it("往上越界停在第一列,不跳到最後一列", () => {
    expect(clamp(-1, 0, ROWS, COLS)).toEqual([0, 0])
  })

  it("往右越界停在最後一欄", () => {
    expect(clamp(0, COLS, ROWS, COLS)).toEqual([0, COLS - 1])
  })

  it("往左越界停在第一欄", () => {
    expect(clamp(0, -1, ROWS, COLS)).toEqual([0, 0])
  })

  it("Ctrl+Home 落在 (0,0)、Ctrl+End 落在 (末列, 末欄)", () => {
    expect(clamp(0, 0, ROWS, COLS)).toEqual([0, 0])
    expect(clamp(ROWS - 1, COLS - 1, ROWS, COLS)).toEqual([ROWS - 1, COLS - 1])
  })

  it("空表(0 列)不產生負索引", () => {
    expect(clamp(0, 0, 0, COLS)).toEqual([0, 0])
  })
})
