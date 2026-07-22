import type { ExecutionContext } from "@nestjs/common"
import type { ConfigService } from "@nestjs/config"
import { describe, expect, it, vi } from "vitest"
import type { DevTenantGuard } from "../http/dev-tenant.guard.js"
import type { AuthGuard } from "./auth-guard.js"
import { TenantGuard } from "./tenant.guard.js"

/* 認證強制分派:prod 一律 AuthGuard;dev/test 依 ENFORCE_AUTH 旗標(預設關 → DevTenantGuard)。 */
function make(nodeEnv: string, enforce: string) {
  const config = {
    get: (key: string) =>
      key === "NODE_ENV" ? nodeEnv : key === "ENFORCE_AUTH" ? enforce : undefined,
  } as unknown as ConfigService
  const auth = { canActivate: vi.fn(() => true) } as unknown as AuthGuard
  const dev = { canActivate: vi.fn(() => true) } as unknown as DevTenantGuard
  return { guard: new TenantGuard(config, auth, dev), auth, dev }
}
const ctx = {} as ExecutionContext

describe("TenantGuard 認證分派", () => {
  it("dev + ENFORCE_AUTH=0(預設)→ DevTenantGuard(x-dev-tenant,免登入)", () => {
    const { guard, auth, dev } = make("development", "0")
    guard.canActivate(ctx)
    expect(dev.canActivate).toHaveBeenCalledOnce()
    expect(auth.canActivate).not.toHaveBeenCalled()
  })

  it("dev + ENFORCE_AUTH=1 → AuthGuard(強制真實 session)", () => {
    const { guard, auth, dev } = make("development", "1")
    guard.canActivate(ctx)
    expect(auth.canActivate).toHaveBeenCalledOnce()
    expect(dev.canActivate).not.toHaveBeenCalled()
  })

  it("production → AuthGuard(不受旗標影響)", () => {
    const { guard, auth, dev } = make("production", "0")
    guard.canActivate(ctx)
    expect(auth.canActivate).toHaveBeenCalledOnce()
    expect(dev.canActivate).not.toHaveBeenCalled()
  })
})
