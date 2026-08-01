import { describe, expect, it } from "vitest"
import { castExpression, quoteColumn, tryCastFunctionSql } from "./cast-sql.js"
import { classifyConversion, isSafeConversion } from "./type-conversions.js"

describe("type conversion whitelist (OQ-FEC-4 = A)", () => {
  it("allows identity and semantic widening on same physical type", () => {
    expect(isSafeConversion("text", "text")).toBe(true)
    expect(isSafeConversion("text", "longText")).toBe(true)
    expect(isSafeConversion("email", "text")).toBe(true)
    expect(isSafeConversion("url", "longText")).toBe(true)
    expect(isSafeConversion("singleSelect", "text")).toBe(true)
  })

  it("rejects narrowing and cross-physical conversions", () => {
    expect(isSafeConversion("longText", "text")).toBe(false)
    expect(isSafeConversion("text", "email")).toBe(false)
    expect(isSafeConversion("money", "text")).toBe(false)
    expect(isSafeConversion("text", "number")).toBe(false)
    expect(isSafeConversion("number", "money")).toBe(false)
    expect(isSafeConversion("rating", "number")).toBe(false)
  })
})

describe("🔴 四態分類(#105)", () => {
  it("**語意零損失但要 DDL → 獨立一態** —— 原案的「三態」把它擠進 lossy 或直接拒絕", () => {
    expect(classifyConversion("singleSelect", "multiSelect").kind).toBe("safe-rewrite")
    expect(classifyConversion("number", "text").kind).toBe("safe-rewrite")
    expect(classifyConversion("date", "text").kind).toBe("safe-rewrite")
    expect(classifyConversion("checkbox", "text").kind).toBe("safe-rewrite")
  })

  it("會清空**或改變**資料 → lossy,且附可直接當文案的說明", () => {
    const multiToSingle = classifyConversion("multiSelect", "singleSelect")
    expect(multiToSingle.kind).toBe("lossy")
    expect(multiToSingle.note).toContain("第一個")
    expect(classifyConversion("text", "number").kind).toBe("lossy")
    expect(classifyConversion("dateTime", "date").note).toContain("時間")
    // 靜默改值也算 lossy —— Airtable 的真實事故是這一類而非清空
    expect(classifyConversion("number", "rating").kind).toBe("lossy")
  })

  it("longText → text 是 lossy 而非 safe:超長內容會變成過不了驗證的值", () => {
    const rule = classifyConversion("longText", "text")
    expect(rule.kind).toBe("lossy")
    expect(rule.note).toContain("長度上限")
  })

  it("系統維護 / 虛擬欄 / 附件類 → forbidden(保留下來也無意義)", () => {
    expect(classifyConversion("text", "autoNumber").kind).toBe("forbidden")
    expect(classifyConversion("formula", "text").kind).toBe("forbidden")
    expect(classifyConversion("text", "attachment").kind).toBe("forbidden")
    expect(classifyConversion("lookup", "text").kind).toBe("forbidden")
  })
})

describe("🔴 轉換運算式:dry-run 與執行共用(#105)", () => {
  it("singleSelect → multiSelect 包成陣列,NULL 保持 NULL", () => {
    expect(castExpression("singleSelect", "multiSelect", quoteColumn("f1"), {}).sql).toContain(
      'ARRAY["f1"]',
    )
  })

  it("multiSelect → singleSelect 取第一個(Baserow 先例,非整批拒絕)", () => {
    expect(castExpression("multiSelect", "singleSelect", quoteColumn("f1"), {}).sql).toBe('"f1"[1]')
  })

  it("**checkbox → text 的字面值固定** —— 跟隨語系會讓同批資料因伺服器而異", () => {
    const { sql } = castExpression("checkbox", "text", "f1", {})
    expect(sql).toContain("'true'")
    expect(sql).toContain("'false'")
  })

  it("**text → date 必須帶明確格式** —— PG 寬鬆解析會依 DateStyle 解成不同日期", () => {
    const { sql, bindings } = castExpression("text", "date", "f1", { dateFormat: "DD/MM/YYYY" })
    expect(sql).toContain("to_date")
    expect(bindings).toContain("DD/MM/YYYY")
  })

  it("rating 夾範圍而非拒絕,上限可設", () => {
    const { sql, bindings } = castExpression("number", "rating", "f1", { ratingMax: 10 })
    expect(sql).toContain("least")
    expect(bindings).toContain(10)
  })

  it("text → checkbox 只認白名單字面,其餘 NULL(不猜)", () => {
    const { sql } = castExpression("text", "checkbox", "f1", {})
    expect(sql).toContain("ELSE NULL")
    expect(sql).toContain("'是'")
  })

  it("**try_cast 只吞資料類錯誤** —— Baserow 用 when others 會把 timeout 也吞成 NULL", () => {
    const sql = tryCastFunctionSql("t1", "numeric", "v::numeric")
    expect(sql).toContain("invalid_text_representation")
    expect(sql).toContain("numeric_value_out_of_range")
    expect(sql).not.toContain("WHEN OTHERS")
    expect(sql).not.toContain("when others")
  })
})

describe("identifier 安全鏈(#105)", () => {
  it("非法欄名一律拒絕 —— 縱深第二道,使用者輸入永不進入 identifier 位置", () => {
    expect(() => quoteColumn('f1"; DROP TABLE x; --')).toThrow()
    expect(() => quoteColumn("F1")).toThrow()
    expect(quoteColumn("f123")).toBe('"f123"')
  })
})
