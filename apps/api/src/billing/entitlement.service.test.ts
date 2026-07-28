import { describe, expect, it, vi } from "vitest"
import type { DrizzleDb } from "../db/db.module.js"
import { EntitlementService } from "./entitlement.service.js"
import { isReadOnlyStatus, isWriteMethod } from "./tenant-status.js"

function dbReturning(row: unknown): DrizzleDb {
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (row === null ? [] : [row]) }) }),
    }),
  } as unknown as DrizzleDb
}

describe("EntitlementService(F-8 地基:一律放行)", () => {
  it("**FMEA B2**:任何能力碼都放行 —— 計費是商業邊界,fail-open", async () => {
    const svc = new EntitlementService(dbReturning({}))
    for (const cap of ["mes.execution", "ai.assistant", "根本不存在的能力"]) {
      await expect(svc.canUse(1, cap)).resolves.toBe(true)
    }
  })

  it("seatLimit 目前不限(null)", async () => {
    const svc = new EntitlementService(dbReturning({}))
    await expect(svc.seatLimit(1)).resolves.toBeNull()
  })

  it("planFor 回租戶方案狀態", async () => {
    const svc = new EntitlementService(
      dbReturning({ planCode: "pro", status: "active", trialEndsAt: null }),
    )
    await expect(svc.planFor(1)).resolves.toEqual({
      planCode: "pro",
      status: "active",
      trialEndsAt: null,
    })
  })

  it("查無租戶 → 預設 active(**不因查不到就擋人**)", async () => {
    const svc = new EntitlementService(dbReturning(null))
    const plan = await svc.planFor(999)
    expect(plan.status).toBe("active")
    expect(plan.planCode).toBeNull()
  })
})

describe("租戶狀態判斷(白名單式)", () => {
  it("只有 suspended / cancelled 為唯讀", () => {
    expect(isReadOnlyStatus("suspended")).toBe(true)
    expect(isReadOnlyStatus("cancelled")).toBe(true)
  })

  it("**FMEA B1**:其餘一切(含 null / undefined / 未知值)皆非唯讀", () => {
    for (const s of ["active", "trial", "past_due", "", "unknown", null, undefined]) {
      expect(isReadOnlyStatus(s)).toBe(false)
    }
  })

  it("寫入方法辨識(大小寫不敏感)", () => {
    for (const m of ["POST", "put", "PATCH", "delete"]) expect(isWriteMethod(m)).toBe(true)
    for (const m of ["GET", "head", "OPTIONS"]) expect(isWriteMethod(m)).toBe(false)
  })
})

describe("配額方案接點", () => {
  it("方案表目前為空 → 落回 env / 程式預設(零行為變化)", async () => {
    // PLAN_QUOTAS 刻意留空(OQ-SB-8=A);此測試在日後填入方案時會提醒重新檢視預期
    const { QuotaService } = await import("../reliability/quota.service.js")
    const svc = new QuotaService(
      dbReturning({
        maxForms: null,
        maxFieldsPerForm: null,
        maxRecordsPerForm: null,
        planCode: "pro",
      }),
      {} as never,
      { get: vi.fn(() => undefined) } as never,
    )
    const quota = await svc.quotaFor(1)
    expect(quota.maxForms).toBe(500)
    expect(quota.maxFieldsPerForm).toBe(200)
  })
})
