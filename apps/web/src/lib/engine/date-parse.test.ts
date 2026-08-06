import {
  formatYmd,
  monthGrid,
  parseLooseDate,
  shiftDays,
  shiftMonths,
} from "@/lib/engine/date-parse"
import { describe, expect, it } from "vitest"

const TODAY = "2026-03-15"

/* 🔴 逐列對應 Ragic 設計手冊 doc/51 的官方例子(查證 2026-08-04)。
   這張表就是規格 —— 改動解析行為時要先改這裡。 */
describe("parseLooseDate:寬鬆解析(對齊 Ragic doc/51)", () => {
  it("8 碼直解", () => {
    expect(parseLooseDate("20151022", TODAY)).toEqual({ ok: true, value: "2015-10-22" })
  })

  it("4 碼 = MMdd,年份補今年(官方:沒有輸入年份,會用現在的年份補上)", () => {
    expect(parseLooseDate("1022", TODAY)).toEqual({ ok: true, value: "2026-10-22" })
  })

  /* 🔴 這一條最容易寫錯:Ragic 在 `dd-MM-yyyy` 格式下輸入 `1022` 得到 `22-10-2015`,
     看起來像「依格式解析」,其實是解成 MM=10/dd=22 之後**顯示**才重排。
     若誤做成依格式解析,`dash` 欄位會靜默存進錯的日期。 */
  it("4 碼的解析**不隨欄位格式改變**(顯示才重排)", () => {
    const parsed = parseLooseDate("1022", TODAY)
    expect(parsed).toEqual({ ok: true, value: "2026-10-22" })
    expect(formatYmd("2026-10-22", "dash")).toBe("22-10-2026")
  })

  it("1–2 碼 = 只有日,年月都補(官方:用現在的年份、月份自動補齊)", () => {
    expect(parseLooseDate("22", TODAY)).toEqual({ ok: true, value: "2026-03-22" })
    expect(parseLooseDate("5", TODAY)).toEqual({ ok: true, value: "2026-03-05" })
  })

  it("分隔符寬鬆,且年份位置由「哪一段是四位數」決定,不看欄位格式", () => {
    for (const s of ["2026/3/5", "2026-3-5", "2026.3.5"]) {
      expect(parseLooseDate(s, TODAY)).toEqual({ ok: true, value: "2026-03-05" })
    }
    /* dd-MM-yyyy 寫法也吃得下 —— 換了欄位格式不會解出不同的日期 */
    expect(parseLooseDate("05-03-2026", TODAY)).toEqual({ ok: true, value: "2026-03-05" })
  })

  it("兩段 = 沒有年份,補今年", () => {
    expect(parseLooseDate("3/5", TODAY)).toEqual({ ok: true, value: "2026-03-05" })
  })

  /* 🔴 解析不出來一律回 ok:false,**不盡力猜一個**。
     同 field-types-parity.md:409 對 text→date 的裁定:即使猜得出來也不猜。 */
  it("解析不出來就回 false —— 不猜", () => {
    for (const s of ["", "abc", "2026-13-01", "2026-02-30", "260305", "1/2/3/4"]) {
      expect(parseLooseDate(s, TODAY)).toEqual({ ok: false })
    }
  })

  it("6 碼刻意不支援 —— 兩位年份要猜世紀,而猜錯不會有人發現", () => {
    expect(parseLooseDate("260305", TODAY)).toEqual({ ok: false })
  })
})

describe("formatYmd:五檔格式", () => {
  it("四個固定檔位不依賴語系", () => {
    expect(formatYmd("2026-03-05", "iso")).toBe("2026-03-05")
    expect(formatYmd("2026-03-05", "slash")).toBe("2026/03/05")
    expect(formatYmd("2026-03-05", "dash")).toBe("05-03-2026")
    expect(formatYmd("2026-03-05", "dot")).toBe("2026.03.05")
  })

  /* 🔴 `local` 用 UTC 建構 + UTC 格式化。直接 `new Date("2026-03-05")` 會被當成
     UTC 午夜,在 UTC-N 的時區印成前一天 —— 本專案已為 pg DATE parser 踩過一次。 */
  it("local 不得位移到前一天", () => {
    expect(formatYmd("2026-03-05", "local", "zh-TW")).toBe("2026/03/05")
    expect(formatYmd("2026-01-01", "local", "zh-TW")).toBe("2026/01/01")
  })
})

describe("月曆格運算", () => {
  it("跨月的格子留 null —— 不畫鄰月日期,避免點到隔壁月而不自覺", () => {
    /* 2026-03-01 是週日 → 前導空格 0;2026-04-01 是週三 → 前導空格 3。
       ⚠️ 用兩個月份對照,避免只驗到「剛好首格是 1 號」的巧合。 */
    const mar = monthGrid(2026, 3)
    expect(mar.length % 7).toBe(0)
    expect(mar.filter((c) => c !== null)).toHaveLength(31)
    expect(mar[0]).toBe("2026-03-01")

    const apr = monthGrid(2026, 4)
    expect(apr.slice(0, 3)).toEqual([null, null, null])
    expect(apr[3]).toBe("2026-04-01")
    expect(apr.filter((c) => c !== null)).toHaveLength(30)
  })

  it("位移日跨月跨年", () => {
    expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01")
  })

  /* 3/31 往前一個月要夾到 2/28,不能溢位成 3/3 —— 那是 Date 的預設行為 */
  it("位移月時把日夾到月底,不溢位", () => {
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28")
    expect(shiftMonths("2026-01-31", 1)).toBe("2026-02-28")
    expect(shiftMonths("2026-12-15", 1)).toBe("2027-01-15")
  })
})
