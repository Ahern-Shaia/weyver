import { describe, expect, it } from "vitest"
import { buildEffectivePermissions } from "./authz-effective.js"
import type { FieldPermissionRow, FormPermissionRow } from "./authz.repository.js"

const fp = (
  roleId: number,
  formId: number,
  level: FormPermissionRow["level"],
): FormPermissionRow => ({
  roleId,
  formId,
  level,
})
const fdp = (
  roleId: number,
  fieldId: number,
  visibility: FieldPermissionRow["visibility"],
): FieldPermissionRow => ({ roleId, fieldId, visibility })

describe("buildEffectivePermissions — deny-by-default", () => {
  it("no rows → 一律 none / 欄位 hidden", () => {
    const p = buildEffectivePermissions(false, [], [])
    expect(p.formLevel(1)).toBe("none")
    expect(p.canRead(1)).toBe(false)
    expect(p.fieldVisibility(10, 1)).toBe("hidden")
  })
})

describe("buildEffectivePermissions — admin 特判", () => {
  it("admin → 任何表 manage、任何欄 write", () => {
    const p = buildEffectivePermissions(true, [], [])
    expect(p.isAdmin).toBe(true)
    expect(p.formLevel(999)).toBe("manage")
    expect(p.canManage(999)).toBe(true)
    expect(p.fieldVisibility(7, 999)).toBe("write")
  })
})

describe("buildEffectivePermissions — 多角色/祖先聯集(較寬鬆勝)", () => {
  it("同表兩列取較高級別", () => {
    const p = buildEffectivePermissions(false, [fp(1, 5, "read"), fp(2, 5, "write")], [])
    expect(p.formLevel(5)).toBe("write")
    expect(p.canWrite(5)).toBe(true)
  })

  it("欄位兩列取較寬鬆可見性", () => {
    const p = buildEffectivePermissions(
      false,
      [fp(1, 5, "write")],
      [fdp(1, 50, "hidden"), fdp(2, 50, "read")],
    )
    expect(p.fieldVisibility(50, 5)).toBe("read")
  })
})

describe("buildEffectivePermissions — 欄位繼承 + 收斂於表單級", () => {
  it("欄位缺列 → 繼承表單級", () => {
    const p = buildEffectivePermissions(false, [fp(1, 5, "write")], [])
    expect(p.fieldVisibility(50, 5)).toBe("write") // 繼承 write
  })

  it("欄位級收斂於表單級:表單 read 之下,欄位給 write 仍只能 read", () => {
    const p = buildEffectivePermissions(false, [fp(1, 5, "read")], [fdp(1, 50, "write")])
    expect(p.fieldVisibility(50, 5)).toBe("read")
  })

  it("表單無權(none)→ 欄位一律 hidden,即使有欄位授權", () => {
    const p = buildEffectivePermissions(false, [], [fdp(1, 50, "write")])
    expect(p.fieldVisibility(50, 5)).toBe("hidden")
  })
})

describe("readableFormIds 過濾(list 端點)", () => {
  it("只留可讀表單;admin 全留", () => {
    const p = buildEffectivePermissions(false, [fp(1, 5, "read"), fp(1, 6, "none")], [])
    expect(p.readableFormIds([5, 6, 7])).toEqual([5])
    const admin = buildEffectivePermissions(true, [], [])
    expect(admin.readableFormIds([5, 6, 7])).toEqual([5, 6, 7])
  })
})
