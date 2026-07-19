import { describe, expect, it } from "vitest"
import { inferColumnType, normalizeColumnNames, toImportValue } from "./excel-import"

describe("inferColumnType", () => {
  it("空欄 → text", () => {
    expect(inferColumnType(["", "  ", ""], 3).type).toBe("text")
  })

  it("全布林詞 → checkbox", () => {
    expect(inferColumnType(["是", "否", "Y", "N"], 4).type).toBe("checkbox")
    expect(inferColumnType(["true", "false"], 2).type).toBe("checkbox")
  })

  it("日期時間 → dateTime", () => {
    expect(inferColumnType(["2026-07-22 09:30", "2026/07/23 10:00:00"], 2).type).toBe("dateTime")
  })

  it("純日期 → date", () => {
    expect(inferColumnType(["2026-07-22", "2026/7/3"], 2).type).toBe("date")
  })

  it("貨幣符號 / 兩位小數 → money", () => {
    expect(inferColumnType(["$1,234.00", "NT$980.50"], 2).type).toBe("money")
    expect(inferColumnType(["128400.00", "980.50"], 2).type).toBe("money")
  })

  it("純整數 → number(非 money)", () => {
    expect(inferColumnType(["12", "3400", "5"], 3).type).toBe("number")
  })

  it("低基數 + 列數足 → singleSelect(相異值為 choices)", () => {
    // 20 列、3 相異值:cap = min(10, 20×0.3=6),3 ≤ 6 → singleSelect
    const cycle = ["待處理", "已完成", "取消"]
    const rows = Array.from({ length: 20 }, (_, i) => cycle[i % 3] as string)
    const inferred = inferColumnType(rows, rows.length)
    expect(inferred.type).toBe("singleSelect")
    expect(inferred.choices).toEqual(["待處理", "已完成", "取消"])
  })

  it("高基數 → text", () => {
    const rows = Array.from({ length: 20 }, (_, i) => `唯一值${i}`)
    expect(inferColumnType(rows, rows.length).type).toBe("text")
  })

  it("列數不足不判 singleSelect,退 text", () => {
    expect(inferColumnType(["甲", "乙"], 2).type).toBe("text")
  })

  it("混型別保守退 text", () => {
    expect(inferColumnType(["100", "abc", "2026-07-22"], 3).type).toBe("text")
  })
})

describe("toImportValue", () => {
  it("空格 → undefined(不送)", () => {
    expect(toImportValue("text", "  ")).toBeUndefined()
  })
  it("checkbox 詞 → boolean", () => {
    expect(toImportValue("checkbox", "是")).toBe(true)
    expect(toImportValue("checkbox", "否")).toBe(false)
  })
  it("number 去逗號 → number", () => {
    expect(toImportValue("number", "1,234")).toBe(1234)
  })
  it("money 去符號逗號 → 保十進位字串(禁 float)", () => {
    expect(toImportValue("money", "$1,234.50")).toBe("1234.50")
  })
  it("dateTime → ISO", () => {
    expect(toImportValue("dateTime", "2026-07-22 09:30")).toContain("2026-07-22")
  })
  it("text 去頭尾空白", () => {
    expect(toImportValue("text", "  鑫豐  ")).toBe("鑫豐")
  })
})

describe("normalizeColumnNames", () => {
  it("空欄名 → 欄N", () => {
    expect(normalizeColumnNames(["單號", "", "供應商"])).toEqual(["單號", "欄2", "供應商"])
  })
  it("重複欄名 → 附序號", () => {
    expect(normalizeColumnNames(["金額", "金額", "金額"])).toEqual(["金額", "金額_2", "金額_3"])
  })
})
