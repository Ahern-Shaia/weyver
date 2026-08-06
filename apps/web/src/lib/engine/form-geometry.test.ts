import { describe, expect, it } from "vitest"

import {
  EMPTY_LAYOUT,
  FORM_DEFAULT_SPAN,
  breaksAfter,
  cellPosition,
  effectiveLayout,
  printRoleOf,
  usedRows,
} from "./form-geometry"
import type { FieldDto, Layout } from "./schemas"

function field(id: number, name: string): FieldDto {
  return {
    id,
    name,
    type: "text",
    position: id,
    required: false,
    options: {},
  } as unknown as FieldDto
}

const layoutWithPrint: Layout = {
  ...EMPTY_LAYOUT,
  fields: {
    "1": { row: 0, col: 0, colSpan: 6 },
    "2": { row: 2, col: 0, colSpan: 12 },
  },
  statics: [{ id: "s1", kind: "text", row: 5, col: 0, text: "備註" }],
  print: { headerRows: [0], footerRows: [2], pageBreakAfterRows: [2] },
}

describe("effectiveLayout", () => {
  it("沒排過版的欄位各自接一列,兩端才會排在同一個位置", () => {
    const out = effectiveLayout([field(1, "甲"), field(2, "乙")], null)
    expect(out.fields["1"]).toEqual({ row: 0, col: 0, colSpan: FORM_DEFAULT_SPAN })
    expect(out.fields["2"]).toEqual({ row: 1, col: 0, colSpan: FORM_DEFAULT_SPAN })
  })

  it("已排版的欄位不被覆寫,新欄位接在最大列之後", () => {
    const out = effectiveLayout([field(1, "甲"), field(9, "新")], layoutWithPrint)
    expect(out.fields["1"]).toEqual({ row: 0, col: 0, colSpan: 6 })
    /* 最大列是 2(欄位),不是 5(靜態元素)—— 這是既有行為,
       釘住它是為了讓「新欄位疊到說明文字上」這種漂移被測試抓到而不是被目測抓到 */
    expect(out.fields["9"]?.row).toBe(3)
  })
})

describe("cellPosition", () => {
  it("轉成 1-based 的 CSS grid 座標", () => {
    expect(cellPosition({ row: 2, col: 3, colSpan: 4 })).toEqual({
      gridColumn: "4 / span 4",
      gridRow: 3,
    })
  })

  it("沒有 colSpan 時用預設寬", () => {
    expect(cellPosition({ row: 0, col: 0 }).gridColumn).toBe(
      `1 / span ${String(FORM_DEFAULT_SPAN)}`,
    )
  })
})

describe("printRoleOf / breaksAfter", () => {
  it("讀出頁首 / 頁尾 / 內文三種角色", () => {
    expect(printRoleOf(layoutWithPrint, 0)).toBe("header")
    expect(printRoleOf(layoutWithPrint, 2)).toBe("footer")
    expect(printRoleOf(layoutWithPrint, 1)).toBe("body")
  })

  it("沒有列印設定時一律是內文,不是丟錯", () => {
    expect(printRoleOf(EMPTY_LAYOUT, 0)).toBe("body")
    expect(printRoleOf(null, 0)).toBe("body")
    expect(breaksAfter(null, 0)).toBe(false)
  })

  it("頁首與頁尾同時被勾時以頁首為準 —— 一列只能有一個角色", () => {
    const both: Layout = {
      ...EMPTY_LAYOUT,
      print: { headerRows: [4], footerRows: [4], pageBreakAfterRows: [] },
    }
    expect(printRoleOf(both, 4)).toBe("header")
  })

  it("換頁列與角色是兩件獨立的事", () => {
    expect(breaksAfter(layoutWithPrint, 2)).toBe(true)
    expect(breaksAfter(layoutWithPrint, 0)).toBe(false)
  })
})

describe("usedRows", () => {
  it("靜態元素獨佔的列也要算進來,否則那一列會從列印分組裡整個消失", () => {
    expect(usedRows(layoutWithPrint)).toEqual([0, 2, 5])
  })

  it("空版面回空陣列", () => {
    expect(usedRows(EMPTY_LAYOUT)).toEqual([])
  })
})
