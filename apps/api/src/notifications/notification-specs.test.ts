import { describe, expect, it } from "vitest"
import {
  LEVEL,
  NOTIFICATION_EVENTS,
  bypassesMasterSwitch,
  isApprovalEvent,
  levelAllows,
  safeTitle,
} from "./notification-specs.js"
import { resolveLevel } from "./notification.service.js"

const E = NOTIFICATION_EVENTS

describe("訂閱層級(OQ-NT-15:有序 enum,非獨立布林)", () => {
  it("靜音 → 資料事件全不收", () => {
    expect(levelAllows(LEVEL.muted, E.recordCreated, false, null)).toBe(false)
    expect(levelAllows(LEVEL.muted, E.recordUpdated, true, null)).toBe(false)
  })

  it("與我相關(預設)→ 只收與我相關的", () => {
    expect(levelAllows(LEVEL.involved, E.recordUpdated, true, null)).toBe(true)
    expect(levelAllows(LEVEL.involved, E.recordUpdated, false, null)).toBe(false)
    expect(levelAllows(LEVEL.involved, E.recordCreated, false, null)).toBe(false)
  })

  it("新資料 + 與我相關 → 嚴格包含前一級", () => {
    expect(levelAllows(LEVEL.involvedPlusNew, E.recordUpdated, true, null)).toBe(true)
    expect(levelAllows(LEVEL.involvedPlusNew, E.recordCreated, false, null)).toBe(true)
    expect(levelAllows(LEVEL.involvedPlusNew, E.recordUpdated, false, null)).toBe(false)
  })

  it("全部 → 全收", () => {
    expect(levelAllows(LEVEL.all, E.recordUpdated, false, null)).toBe(true)
  })

  it("自訂 = 與我相關之上**加選**(GitLab 語意,保持有序)", () => {
    expect(levelAllows(LEVEL.custom, E.recordUpdated, true, [])).toBe(true)
    expect(levelAllows(LEVEL.custom, E.recordCreated, false, [E.recordCreated])).toBe(true)
    expect(levelAllows(LEVEL.custom, E.recordUpdated, false, [E.recordCreated])).toBe(false)
  })

  it("**簽核類不受層級管** —— 指名要你做事,不是旁觀資訊", () => {
    for (const level of [LEVEL.muted, LEVEL.involved, LEVEL.all]) {
      expect(levelAllows(level, E.approvalPending, false, null)).toBe(true)
      expect(levelAllows(level, E.approvalRejected, false, null)).toBe(true)
    }
    expect(isApprovalEvent(E.approvalOverdue)).toBe(true)
    expect(isApprovalEvent(E.recordCreated)).toBe(false)
  })

  it("**逾期是總開關的唯一例外**(裁定 ④)", () => {
    expect(bypassesMasterSwitch(E.approvalOverdue)).toBe(true)
    for (const e of [E.approvalPending, E.approvalApproved, E.recordCreated]) {
      expect(bypassesMasterSwitch(e)).toBe(false)
    }
  })
})

describe("繼承解析(最具體者勝;缺列 = 繼承上層非關閉)", () => {
  const P = (scope: string, scopeId: number | null, level: number) => ({
    scope,
    scopeId,
    level,
    customEvents: null,
  })

  it("完全無設定 → 系統預設(與我相關)", () => {
    expect(resolveLevel([], null, 1).level).toBe(LEVEL.involved)
  })

  it("只有租戶層 → 用租戶層", () => {
    expect(resolveLevel([P("tenant", null, LEVEL.all)], null, 1).level).toBe(LEVEL.all)
  })

  it("分類層覆寫租戶層", () => {
    const prefs = [P("tenant", null, LEVEL.all), P("category", 7, LEVEL.muted)]
    expect(resolveLevel(prefs, 7, 1).level).toBe(LEVEL.muted)
  })

  it("**表單層最具體,勝過分類與租戶**", () => {
    const prefs = [
      P("tenant", null, LEVEL.all),
      P("category", 7, LEVEL.muted),
      P("form", 1, LEVEL.involvedPlusNew),
    ]
    expect(resolveLevel(prefs, 7, 1).level).toBe(LEVEL.involvedPlusNew)
  })

  it("不同分類 / 不同表單的設定不會誤用", () => {
    const prefs = [P("category", 99, LEVEL.muted), P("form", 42, LEVEL.muted)]
    expect(resolveLevel(prefs, 7, 1).level).toBe(LEVEL.involved)
  })

  it("表單未分類時跳過分類層", () => {
    const prefs = [P("tenant", null, LEVEL.all), P("category", 7, LEVEL.muted)]
    expect(resolveLevel(prefs, null, 1).level).toBe(LEVEL.all)
  })
})

describe("FMEA N14 標題安全", () => {
  it("**標題只用表單名 + 記錄編號,絕不碰使用者欄位**", () => {
    expect(safeTitle("採購申請單", 104)).toBe("採購申請單 #104")
    expect(safeTitle("採購申請單", null)).toBe("採購申請單")
  })

  it("即使表單有敏感首欄,標題仍不含其值", () => {
    // titleOf() 取 fields[0] 的作法會洩漏;safeTitle 不接受欄位值當參數,型別上就不可能傳入
    const title = safeTitle("薪資表", 8)
    expect(title).not.toMatch(/\d{4,}/) // 不含金額 / 身分證這類長數字
    expect(title).toBe("薪資表 #8")
  })
})
