import { describe, expect, it } from "vitest"
import { buildEffectivePermissions } from "./authz-effective.js"
import type { FormAction } from "./authz-model.js"
import type { FieldPermissionRow, FormPermissionRow } from "./authz.repository.js"

const fp = (roleId: number, formId: number, actions: FormAction[]): FormPermissionRow => ({
  roleId,
  formId,
  actions,
})
const fdp = (
  roleId: number,
  fieldId: number,
  visibility: FieldPermissionRow["visibility"],
): FieldPermissionRow => ({ roleId, fieldId, visibility })

describe("buildEffectivePermissions — deny-by-default", () => {
  it("no rows → 無任何動作 / 欄位 hidden", () => {
    const p = buildEffectivePermissions(false, [], [])
    expect(p.hasAction(1, "view")).toBe(false)
    expect(p.canRead(1)).toBe(false)
    expect(p.fieldVisibility(10, 1)).toBe("hidden")
  })
})

describe("buildEffectivePermissions — admin 特判", () => {
  it("admin → 任何表任何動作、任何欄 write", () => {
    const p = buildEffectivePermissions(true, [], [])
    expect(p.isAdmin).toBe(true)
    expect(p.hasAction(999, "delete")).toBe(true)
    expect(p.hasAction(999, "design")).toBe(true)
    expect(p.canManage(999)).toBe(true)
    expect(p.fieldVisibility(7, 999)).toBe("write")
  })
})

describe("buildEffectivePermissions — 多角色/祖先動作聯集", () => {
  it("同表多列動作取聯集", () => {
    const p = buildEffectivePermissions(
      false,
      [fp(1, 5, ["view", "create"]), fp(2, 5, ["edit"])],
      [],
    )
    expect([...p.formActions(5)].sort()).toEqual(["create", "edit", "view"])
    expect(p.hasAction(5, "delete")).toBe(false)
  })

  it("欄位兩列取較寬鬆可見性", () => {
    const p = buildEffectivePermissions(
      false,
      [fp(1, 5, ["view", "edit"])],
      [fdp(1, 50, "hidden"), fdp(2, 50, "read")],
    )
    expect(p.fieldVisibility(50, 5)).toBe("read")
  })
})

describe("buildEffectivePermissions — 欄位繼承 + 收斂於表單動作集", () => {
  it("欄位缺列 → 繼承(表單有 edit → write)", () => {
    const p = buildEffectivePermissions(false, [fp(1, 5, ["view", "edit"])], [])
    expect(p.fieldVisibility(50, 5)).toBe("write")
  })

  it("表單僅 view(無寫動作)→ 欄位給 write 仍降 read", () => {
    const p = buildEffectivePermissions(false, [fp(1, 5, ["view"])], [fdp(1, 50, "write")])
    expect(p.fieldVisibility(50, 5)).toBe("read")
  })

  it("表單無 view → 欄位一律 hidden,即使有欄位授權", () => {
    const p = buildEffectivePermissions(false, [], [fdp(1, 50, "write")])
    expect(p.fieldVisibility(50, 5)).toBe("hidden")
  })
})

describe("readableFormIds 過濾(list 端點)", () => {
  it("只留有 view 的表單;admin 全留", () => {
    const p = buildEffectivePermissions(false, [fp(1, 5, ["view"]), fp(1, 6, ["create"])], [])
    // form 6 有 create 但無 view → 不可讀
    expect(p.readableFormIds([5, 6, 7])).toEqual([5])
    const admin = buildEffectivePermissions(true, [], [])
    expect(admin.readableFormIds([5, 6, 7])).toEqual([5, 6, 7])
  })
})
