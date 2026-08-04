import { describe, expect, it } from "vitest"
import { displayValue, formatDateTime, formatMoney, formatNumber } from "./display-value"

/* 🔴 docs/14 把**金額與時間戳**列為信任訊號。原樣印出資料庫的內部表示
   (`128400.0000`、`2026-07-19T05:45:02.592Z`)效果恰好相反 —— 看起來像沒做完。
   這份測試釘住的是「使用者看到的樣子」,不是內部值。 */

const f = (type: string, options: Record<string, unknown> = {}) => ({ type, options }) as never

describe("🔴 金額", () => {
  /* 引擎存 numeric(19,4) 且**邊界收十進位字串**(鐵則 2)—— 格式化必須吃得下字串 */
  it("十進位字串加千分位,小數位依幣別", () => {
    /* ⚠️ ICU 對 TWD 給的是 **2 位**(非 0 位)。初版註解憑印象寫「TWD 慣例 0 位」,
       被這條測試打臉 —— 正是不自己列表的理由:列表會憑印象寫錯。 */
    expect(formatMoney("128400.0000", "TWD")).toBe("128,400.00")
    expect(formatMoney("128400.0000", "USD")).toBe("128,400.00")
  })

  /* 🔴 小數位問 Intl 不自己列表:TWD 0 位、USD 2 位、JPY 0 位。
     自己抄一份對照表只會抄錯或過期。 */
  it("🔴 幣別的小數位取自 ICU,非硬編(JPY 確實是 0 位)", () => {
    expect(formatMoney("1234.5", "JPY")).toBe("1,235")
    expect(formatMoney("1234.5", "EUR")).toBe("1,234.50")
  })

  it("未知幣別退回 2 位而不是壞掉", () => {
    expect(formatMoney("1234.5", "ZZZ")).toBe("1,234.50")
  })

  it("非數字原樣回傳 —— 寧可顯示原值也不要顯示 NaN", () => {
    expect(formatMoney("待補", "TWD")).toBe("待補")
  })
})

describe("數量與百分比", () => {
  /* 🔴 數量 320 不該變成 320.00 —— 強制小數位會讓整數看起來像金額 */
  it("🔴 一般數字加千分位但不強制小數位", () => {
    expect(formatNumber(320)).toBe("320")
    expect(formatNumber("1234567.5")).toBe("1,234,567.5")
  })

  it("百分比帶 % 記號", () => {
    expect(displayValue(f("percent"), 15)).toBe("15%")
  })
})

describe("🔴 時間", () => {
  it("ISO 字串轉成可讀的當地時間", () => {
    const out = formatDateTime("2026-07-19T05:45:02.592Z", { timeZone: "Asia/Taipei" })
    expect(out).toContain("2026")
    /* 毫秒與 Z 不得出現在畫面上 */
    expect(out).not.toContain(".592")
    expect(out).not.toContain("Z")
    expect(out).not.toContain("T")
  })

  it("🔴 依顯示時區換算 —— 同一時刻在不同時區是不同的當地時間", () => {
    const tpe = formatDateTime("2026-07-19T20:00:00.000Z", { timeZone: "Asia/Taipei" })
    const utc = formatDateTime("2026-07-19T20:00:00.000Z", { timeZone: "UTC" })
    expect(tpe).not.toBe(utc)
  })

  it("date 型別不顯示時間段", () => {
    const out = displayValue(f("date"), "2026-07-19", { timeZone: "Asia/Taipei" })
    expect(out).not.toMatch(/\d{2}:\d{2}/)
  })

  /* 🔴 系統時間欄(createdAt / updatedAt)與 dateTime 是不同的型別名,
     漏列的話會安靜地退回 String() —— 這條是瀏覽器實走抓到後補的。 */
  it("🔴 系統時間欄也要格式化(createdAt / updatedAt)", () => {
    for (const t of ["createdAt", "updatedAt"]) {
      const out = displayValue(f(t), "2026-07-19T05:45:02.592Z", { timeZone: "Asia/Taipei" })
      expect(out).not.toContain("T")
      expect(out).not.toContain("Z")
    }
  })

  it("壞值原樣回傳,不顯示 Invalid Date", () => {
    expect(formatDateTime("不是日期")).toBe("不是日期")
  })
})

describe("空值與集合", () => {
  it("空值一律破折號 —— 空字串與 null 對使用者是同一件事", () => {
    expect(displayValue(f("text"), null)).toBe("—")
    expect(displayValue(f("text"), "")).toBe("—")
    expect(displayValue(f("money"), null)).toBe("—")
  })

  it("多選以頓號串接", () => {
    expect(displayValue(f("multiSelect"), ["甲", "乙"])).toBe("甲、乙")
  })

  it("布林顯示是 / 否", () => {
    expect(displayValue(f("checkbox"), true)).toBe("是")
  })
})

/* 🔴 型別驅動而非猜值的長相。猜的話「看起來像日期的文字欄」會被誤格式化,
   而那正是不一致的來源。 */
describe("🔴 型別驅動", () => {
  it("文字欄裡的數字字串不得被加上千分位", () => {
    expect(displayValue(f("text"), "128400")).toBe("128400")
  })

  it("文字欄裡的 ISO 字串不得被當成時間格式化", () => {
    expect(displayValue(f("text"), "2026-07-19T05:45:02.592Z")).toBe("2026-07-19T05:45:02.592Z")
  })
})

/* 🔴 audit-D §2.4|格式遮罩。此 option 自 M3 出貨以來只有 schema —— 設計器沒有入口、
   渲染端沒有分支,打 API 設了也不會有任何效果。 */
describe("displayMask", () => {
  const f = (displayMask?: string) => ({
    type: "text" as const,
    options: displayMask === undefined ? {} : { displayMask },
  })

  it("`#` 逐一吃值的字元,其餘字元原樣插入", () => {
    expect(displayValue(f("###-##-####"), "123456789")).toBe("123-45-6789")
  })

  it("沒設遮罩 → 原值", () => {
    expect(displayValue(f(), "123456789")).toBe("123456789")
  })

  /* 🔴 值比樣板長時**接在後面,不截斷** —— 截斷等於在畫面上偽造資料 */
  it("值比樣板長 → 多的接在後面", () => {
    expect(displayValue(f("###-###"), "1234567890")).toBe("123-4567890")
  })

  it("值比樣板短 → 畫到值用完為止,不補佔位符", () => {
    expect(displayValue(f("###-###"), "12")).toBe("12")
  })

  it("儲存的仍是原值 —— 遮罩只在顯示層(空值仍走既有的『—』)", () => {
    expect(displayValue(f("###-###"), "")).toBe("—")
  })
})
