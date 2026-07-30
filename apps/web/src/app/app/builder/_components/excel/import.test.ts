import { describe, expect, it } from "vitest"
import { inferColumnType, normalizeColumnNames, toImportValue } from "@/app/app/builder/_components/excel/import"

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

describe("🔴 識別碼一票否決(追溯稽核:匯入即毀資料)", () => {
  it("**前導零不得被數值化** —— 郵遞區號 / 舊料號", () => {
    expect(inferColumnType(["00123", "00456", "00789"], 3).type).toBe("text")
  })

  it("**台灣手機號不得被數值化** —— 0912345678 會變成 912345678", () => {
    expect(inferColumnType(["0912345678", "0987654321"], 2).type).toBe("text")
  })

  it("統編 / 身分證長度之純數字退 text", () => {
    expect(inferColumnType(["12345678", "87654321"], 2).type).toBe("text")
    expect(inferColumnType(["A123456789", "B234567890"], 2).type).toBe("text")
  })

  it("超過安全整數精度者退 text", () => {
    expect(inferColumnType(["1234567890123456", "9876543210987654"], 2).type).toBe("text")
  })

  it("含分隔符的電話退 text", () => {
    expect(inferColumnType(["02-1234-5678", "03-987-6543"], 2).type).toBe("text")
    expect(inferColumnType(["+886912345678", "+886987654321"], 2).type).toBe("text")
  })

  it("**欄名為量值時不誤擋** —— 「數量」欄的 8 位數仍判數字", () => {
    expect(inferColumnType(["12345678", "87654321"], 2, "數量").type).toBe("number")
    expect(inferColumnType(["12345678", "87654321"], 2, "金額").type).toBe("number")
  })

  it("一般數字不受影響", () => {
    expect(inferColumnType(["12", "345", "6789"], 3).type).toBe("number")
    expect(inferColumnType(["1.5", "2.75"], 2).type).toBe("number")
  })

  it("**只要有一格像識別碼,整欄退 text**(不可逆風險優先)", () => {
    expect(inferColumnType(["123", "456", "00789"], 3).type).toBe("text")
  })
})

describe("🔴 分層取樣(追溯稽核 #106)", () => {
  it("**尾端的異常值要看得到** —— 只取前 50 列會把整欄推成 number,匯入時 N/A 靜默變空", () => {
    const values = [...Array.from({ length: 900 }, (_, i) => String(i + 1)), "N/A", "待確認"]
    expect(inferColumnType(values, values.length, "數量").type).toBe("text")
  })

  it("中段的異常值同樣要看到", () => {
    const values = Array.from({ length: 900 }, (_, i) => (i === 450 ? "未提供" : String(i + 1)))
    expect(inferColumnType(values, values.length, "數量").type).toBe("text")
  })

  it("整欄乾淨的大檔仍正確判為 number(不因取樣改動而過度保守)", () => {
    const values = Array.from({ length: 900 }, (_, i) => String(i + 1))
    expect(inferColumnType(values, values.length, "數量").type).toBe("number")
  })
})
