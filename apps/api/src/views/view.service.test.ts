import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import type { AuthzRepository } from "../authz/authz.repository.js"
import type { TenantContext } from "../http/tenant-context.js"
import type { CreateViewInput, ViewRepository, ViewRow } from "./view.repository.js"
import { ViewService } from "./view.service.js"

/* R1·UP-2 視圖 admin-gating 單元測(dev header 恆 superAdmin,故 403 分支以 mock 驗)。 */

function fakeRow(o: Partial<ViewRow> = {}): ViewRow {
  return {
    id: o.id ?? 1,
    tenantId: o.tenantId ?? 1,
    formId: o.formId ?? 10,
    name: o.name ?? "v",
    scope: o.scope ?? "personal",
    isDefault: o.isDefault ?? false,
    locked: o.locked ?? false,
    config: o.config ?? {
      fields: [],
      filter: { combinator: "and", conditions: [] },
      sorts: [],
      groupBy: [],
      aggregates: [],
    },
    position: o.position ?? 0,
    createdBy: o.createdBy ?? 5,
    updatedAt: o.updatedAt ?? new Date("2026-07-25T00:00:00Z"),
  }
}

function makeService(opts: {
  isAdmin: boolean
  existing?: ViewRow | null
  formExists?: boolean
}): ViewService {
  const repo = {
    formExists: vi.fn().mockResolvedValue(opts.formExists ?? true),
    listForActor: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(opts.existing ?? null),
    create: vi.fn().mockImplementation((input: CreateViewInput) =>
      Promise.resolve(
        fakeRow({
          scope: input.scope,
          name: input.name,
          isDefault: input.isDefault,
          formId: input.formId,
          createdBy: input.actorId,
        }),
      ),
    ),
    update: vi.fn().mockResolvedValue(undefined),
    softDelete: vi.fn().mockResolvedValue(undefined),
  }
  const authz = { isAdminActor: vi.fn().mockResolvedValue(opts.isAdmin) }
  return new ViewService(repo as unknown as ViewRepository, authz as unknown as AuthzRepository)
}

const nonAdmin: TenantContext = { tenantId: 1, actorId: 5 }
const superAdmin: TenantContext = { tenantId: 1, actorId: 5, isSuperAdmin: true }
const cfg = {
  fields: [],
  filter: { combinator: "and" as const, conditions: [] },
  sorts: [],
  groupBy: [],
  aggregates: [],
}

describe("ViewService admin-gating", () => {
  it("非 admin 建共通視圖 → Forbidden", async () => {
    const s = makeService({ isAdmin: false })
    await expect(
      s.create(nonAdmin, 10, {
        name: "共通",
        scope: "shared",
        config: cfg,
        isDefault: false,
        locked: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("非 admin 建個人視圖 → 允許", async () => {
    const s = makeService({ isAdmin: false })
    const dto = await s.create(nonAdmin, 10, {
      name: "個人",
      scope: "personal",
      config: cfg,
      isDefault: false,
      locked: false,
    })
    expect(dto.scope).toBe("personal")
  })

  it("非 admin 個人 + isDefault → Forbidden(admin-gated 屬性)", async () => {
    const s = makeService({ isAdmin: false })
    await expect(
      s.create(nonAdmin, 10, {
        name: "x",
        scope: "personal",
        config: cfg,
        isDefault: true,
        locked: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("admin 共通 + isDefault → 允許", async () => {
    const s = makeService({ isAdmin: true })
    const dto = await s.create(superAdmin, 10, {
      name: "共通預設",
      scope: "shared",
      config: cfg,
      isDefault: true,
      locked: false,
    })
    expect(dto.isDefault).toBe(true)
  })

  it("建視圖於不存在的表單 → NotFound", async () => {
    const s = makeService({ isAdmin: true, formExists: false })
    await expect(
      s.create(superAdmin, 99, {
        name: "x",
        scope: "personal",
        config: cfg,
        isDefault: false,
        locked: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it("admin 個人 + isDefault → BadRequest(預設必為共通)", async () => {
    const s = makeService({ isAdmin: true })
    await expect(
      s.create(superAdmin, 10, {
        name: "x",
        scope: "personal",
        config: cfg,
        isDefault: true,
        locked: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it("非 admin 改共通視圖 → Forbidden", async () => {
    const s = makeService({ isAdmin: false, existing: fakeRow({ scope: "shared", formId: 10 }) })
    await expect(s.update(nonAdmin, 10, 1, { name: "改" })).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it("非 admin 改他人個人視圖 → Forbidden", async () => {
    const s = makeService({
      isAdmin: false,
      existing: fakeRow({ scope: "personal", createdBy: 999, formId: 10 }),
    })
    await expect(s.update(nonAdmin, 10, 1, { name: "改" })).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it("非 admin 改自己的個人視圖 → 允許", async () => {
    const s = makeService({
      isAdmin: false,
      existing: fakeRow({ scope: "personal", createdBy: 5, formId: 10 }),
    })
    const dto = await s.update(nonAdmin, 10, 1, { name: "改" })
    expect(dto.id).toBe(1)
  })
})
