import type { ExecutionContext } from "@nestjs/common"
import type { ConfigService } from "@nestjs/config"
import { describe, expect, it, vi } from "vitest"
import type { EntitlementService } from "../billing/entitlement.service.js"
import type { DevTenantGuard } from "../http/dev-tenant.guard.js"
import type { AuthGuard } from "./auth-guard.js"
import { TenantGuard } from "./tenant.guard.js"

/* 認證強制分派:prod 一律 AuthGuard;dev/test 依 ENFORCE_AUTH 旗標(預設關 → DevTenantGuard)。
   F-8:另測租戶生命週期(停權唯讀),重點在 FMEA B1「未知狀態必須放行」。 */
function make(nodeEnv: string, enforce: string, status = "active") {
  const config = {
    get: (key: string) =>
      key === "NODE_ENV" ? nodeEnv : key === "ENFORCE_AUTH" ? enforce : undefined,
  } as unknown as ConfigService
  const auth = { canActivate: vi.fn(() => true) } as unknown as AuthGuard
  const dev = { canActivate: vi.fn(() => true) } as unknown as DevTenantGuard
  const entitlement = {
    planFor: vi.fn(async () => ({ planCode: null, status, trialEndsAt: null })),
  } as unknown as EntitlementService
  return { guard: new TenantGuard(config, auth, dev, entitlement), auth, dev, entitlement }
}

/* tenantId 用 null 表示「未解析」而非 undefined —— 顯式傳 undefined 會觸發預設參數。 */
function ctxOf(method = "GET", tenantId: number | null = 1): ExecutionContext {
  const request = { method, tenantContext: tenantId === null ? undefined : { tenantId } }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe("TenantGuard 認證分派", () => {
  it("dev + ENFORCE_AUTH=0(預設)→ DevTenantGuard(x-dev-tenant,免登入)", async () => {
    const { guard, auth, dev } = make("development", "0")
    await guard.canActivate(ctxOf())
    expect(dev.canActivate).toHaveBeenCalledOnce()
    expect(auth.canActivate).not.toHaveBeenCalled()
  })

  it("dev + ENFORCE_AUTH=1 → AuthGuard(強制真實 session)", async () => {
    const { guard, auth, dev } = make("development", "1")
    await guard.canActivate(ctxOf())
    expect(auth.canActivate).toHaveBeenCalledOnce()
    expect(dev.canActivate).not.toHaveBeenCalled()
  })

  it("production → AuthGuard(不受旗標影響)", async () => {
    const { guard, auth, dev } = make("production", "0")
    await guard.canActivate(ctxOf())
    expect(auth.canActivate).toHaveBeenCalledOnce()
    expect(dev.canActivate).not.toHaveBeenCalled()
  })
})

describe("TenantGuard 租戶生命週期(F-8)", () => {
  it("active 租戶寫入 → 放行(既有行為不變)", async () => {
    const { guard } = make("development", "0", "active")
    await expect(guard.canActivate(ctxOf("POST"))).resolves.toBe(true)
  })

  it("suspended 租戶**讀取**仍放行 —— 客戶必須能取回自己的資料(OQ-SB-5=A)", async () => {
    const { guard, entitlement } = make("development", "0", "suspended")
    await expect(guard.canActivate(ctxOf("GET"))).resolves.toBe(true)
    // 讀取路徑連查都不查,不為每個 GET 增加一次 DB round-trip
    expect(entitlement.planFor).not.toHaveBeenCalled()
  })

  it("suspended 租戶寫入 → 403 TENANT_READ_ONLY", async () => {
    const { guard } = make("development", "0", "suspended")
    await expect(guard.canActivate(ctxOf("POST"))).rejects.toMatchObject({
      response: { code: "TENANT_READ_ONLY" },
    })
  })

  it("cancelled 亦為唯讀", async () => {
    const { guard } = make("development", "0", "cancelled")
    await expect(guard.canActivate(ctxOf("DELETE"))).rejects.toMatchObject({
      response: { code: "TENANT_READ_ONLY" },
    })
  })

  it("**FMEA B1**:未知 / 未來新增的狀態值一律放行(白名單式,非黑名單)", async () => {
    for (const status of ["trial", "past_due", "grace_period", "", "什麼鬼"]) {
      const { guard } = make("development", "0", status)
      await expect(guard.canActivate(ctxOf("POST"))).resolves.toBe(true)
    }
  })

  it("租戶未解析(公開路由)→ 不做生命週期檢查", async () => {
    const { guard, entitlement } = make("development", "0", "suspended")
    await expect(guard.canActivate(ctxOf("POST", null))).resolves.toBe(true)
    expect(entitlement.planFor).not.toHaveBeenCalled()
  })
})
