import { ForbiddenException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import type { AiConfigService } from "./ai-config.service.js"
import { AiController } from "./ai.controller.js"

/* 🔴 「寫設定限 admin」這條規則**只能在這一層測**。

   整合測試走 dev 車道,而 dev 一律 `isSuperAdmin`
   (`authz-http.ts:22` 逐字「整條分支從來沒有人走過」)——
   於是 `permissions.isAdmin` 對任何 dev actor 都是 true,
   在那裡寫「非 admin 被擋」的斷言會**空過**。 */

const tenant = { tenantId: 1, actorId: 7 }
const perms = (isAdmin: boolean): EffectivePermissions => ({ isAdmin }) as EffectivePermissions

describe("AiController 的 admin 分界", () => {
  it("🔴 非 admin 寫設定 → 403,而且 service 完全不被呼叫", async () => {
    const svc = { update: vi.fn(), get: vi.fn(), usageSince: vi.fn() }
    const controller = new AiController(svc as unknown as AiConfigService)

    await expect(
      controller.patchConfig(tenant, perms(false), { model: "gpt-5.2" }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    /* 擋在呼叫之前,不是「呼叫了再回滾」 */
    expect(svc.update).not.toHaveBeenCalled()
  })

  it("admin 寫得進去", async () => {
    const svc = { update: vi.fn().mockResolvedValue({ enabled: false }), get: vi.fn() }
    const controller = new AiController(svc as unknown as AiConfigService)

    await controller.patchConfig(tenant, perms(true), { model: "gpt-5.2" })
    expect(svc.update).toHaveBeenCalledWith(1, 7, { model: "gpt-5.2" })
  })

  it("讀設定不看 admin —— 使用者要知道 AI 有沒有開", async () => {
    const svc = { get: vi.fn().mockResolvedValue({ enabled: true }) }
    const controller = new AiController(svc as unknown as AiConfigService)

    await expect(controller.config(tenant)).resolves.toMatchObject({ enabled: true })
    expect(svc.get).toHaveBeenCalledWith(1)
  })
})
