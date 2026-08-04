import { describe, expect, it } from "vitest"
import { csvCell, csvRow } from "./csv.js"

/* 🔴 匯出端的 CSV 注入。既有 `hasSpreadsheetFormula()` 是**偵測上傳並拒收**;
   這一支是**產生時跳脫**。方向相反,照抄會做出錯的行為。 */

describe("🔴 公式跳脫(OWASP CSV Injection,輸出端)", () => {
  it("以 = + - @ Tab CR 開頭者前置單引號", () => {
    /* 單引號不是 RFC 4180 的特殊字元 → 不必包雙引號,只前置一個 ' */
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1")
    expect(csvCell("+1234")).toBe("'+1234")
    expect(csvCell("-1+1")).toBe("'-1+1")
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(csvCell("\tx")).toBe("'\tx")
  })

  it("一般值不動 —— 過度跳脫會讓每一格都多一個引號", () => {
    expect(csvCell("採購單")).toBe("採購單")
    expect(csvCell(128400)).toBe("128400")
    expect(csvCell("a-b")).toBe("a-b")
  })

  /* 🔴 負數是**合法資料**且以 `-` 開頭 —— 跳脫後在 Excel 裡會變成文字,
     客戶拿去加總會得到 0。這是「防注入把資料弄壞」的典型;
     此處明確記錄現況取捨:安全優先,但值本身完整保留(前置引號不進儲存格內容)。 */
  it("負數會被前置單引號(已知取捨:Excel 視為文字,但值不失真)", () => {
    expect(csvCell(-500)).toBe("'-500")
  })
})

describe("RFC 4180 逃逸", () => {
  it("含逗號 / 引號 / 換行者以雙引號包住", () => {
    expect(csvCell("a,b")).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"')
  })

  /* 🔴 兩條規則同時成立時,**先加單引號再包雙引號**。
     反過來的話單引號會落在引號外面,產出 `'"..."` —— 檔案結構就壞了。 */
  it("🔴 公式 + 逗號同時發生時順序正確", () => {
    expect(csvCell("=A1,B1")).toBe('"\'=A1,B1"')
  })
})

describe("值的轉換", () => {
  it("null / undefined → 空字串,不是字面的 null", () => {
    expect(csvCell(null)).toBe("")
    expect(csvCell(undefined)).toBe("")
  })

  /* 🔴 多選 / 附件是陣列。`String([1,2])` 得到 `1,2` —— 在 CSV 裡看起來是兩欄,
     是**靜默的資料錯位**。走 JSON 才留得住結構。 */
  it("🔴 陣列與物件走 JSON,不得被攤成多欄", () => {
    expect(csvCell(["甲", "乙"])).toBe('"[""甲"",""乙""]"')
    expect(csvCell({ key: "k" })).toBe('"{""key"":""k""}"')
  })

  it("列以 CRLF 結尾(RFC 4180)", () => {
    expect(csvRow(["a", "b"])).toBe("a,b\r\n")
  })
})

/* 🔴 R1·FMT M1 之後補(audit-C / task #26)。

   **本專案有兩種匯出,職責刻意不同**(見 `docs/modules/R1/data-export.md` §0):
   · 列表頁的「匯出 Excel」= **所見即所得** —— 走 `formatFieldValue`,金額是 `128,400.00`
   · 這一支(租戶封存)= **帶得走** —— 原值不格式化,供再匯入

   兩者若哪天被「統一」成同一套,失效方式完全不同:
   前者少一列沒人會死;**後者把 `128400.0000` 變成 `128,400.00`,再匯入時就是壞資料**
   (千分位逗號在 CSV 裡還會多切一欄)。故在此明文釘住。 */
describe("封存匯出保留原值(不套顯示格式)", () => {
  it("金額維持引擎的十進位字串,不加千分位", () => {
    expect(csvCell("128400.0000")).toBe("128400.0000")
  })

  it("日期維持 ISO,不套欄位級 dateFormat", () => {
    expect(csvCell("2026-03-05")).toBe("2026-03-05")
    expect(csvCell(new Date("2026-03-05T10:00:00.000Z"))).toBe("2026-03-05T10:00:00.000Z")
  })
})
