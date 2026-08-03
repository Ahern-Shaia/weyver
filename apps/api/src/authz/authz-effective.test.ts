import { describe, expect, it } from "vitest"
import { type EffectivePermissionsInput, buildEffectivePermissions } from "./authz-effective.js"
import type { FormAction } from "./authz-model.js"
import type {
  CategoryPermissionRow,
  FieldPermissionRow,
  FormMetaRow,
  FormPermissionRow,
} from "./authz.repository.js"

const fp = (
  roleId: number,
  formId: number,
  actions: FormAction[],
  scopedActions: FormAction[] = [],
): FormPermissionRow => ({
  roleId,
  formId,
  actions,
  scopedActions,
})
const cp = (roleId: number, categoryId: number, actions: FormAction[]): CategoryPermissionRow => ({
  roleId,
  categoryId,
  actions,
})
const fdp = (
  roleId: number,
  fieldId: number,
  visibility: FieldPermissionRow["visibility"],
): FieldPermissionRow => ({ roleId, fieldId, visibility })
const meta = (
  formId: number,
  o?: { categoryId?: number | null; isSensitive?: boolean; createdBy?: number | null },
): FormMetaRow => ({
  formId,
  categoryId: o?.categoryId ?? null,
  isSensitive: o?.isSensitive ?? false,
  createdBy: o?.createdBy ?? null,
})

function build(opts: Partial<EffectivePermissionsInput>) {
  return buildEffectivePermissions({
    isAdmin: opts.isAdmin ?? false,
    actorId: opts.actorId ?? null,
    roleIds: opts.roleIds ?? [1, 2],
    formRows: opts.formRows ?? [],
    categoryRows: opts.categoryRows ?? [],
    fieldRows: opts.fieldRows ?? [],
    formMeta: opts.formMeta ?? [],
    defaultActions: opts.defaultActions ?? [],
  })
}

describe("deny-by-default", () => {
  it("無任何來源 → 無動作 / 欄位 hidden", () => {
    const p = build({ formMeta: [meta(1)] })
    expect(p.canRead(1)).toBe(false)
    expect(p.fieldVisibility(10, 1)).toBe("hidden")
  })
})

describe("admin 特判", () => {
  it("admin → 任何表任何動作、任何欄 write", () => {
    const p = build({ isAdmin: true })
    expect(p.isAdmin).toBe(true)
    expect(p.hasAction(999, "delete")).toBe(true)
    expect(p.canManage(999)).toBe(true)
    expect(p.fieldVisibility(7, 999)).toBe("write")
  })
})

describe("覆寫層(form_permissions)+ 多角色聯集", () => {
  it("同表多角色動作取聯集", () => {
    const p = build({
      roleIds: [1, 2],
      formRows: [fp(1, 5, ["view", "create"]), fp(2, 5, ["edit"])],
      formMeta: [meta(5)],
    })
    expect([...p.formActions(5)].sort()).toEqual(["create", "edit", "view"])
    expect(p.hasAction(5, "delete")).toBe(false)
  })

  it("欄位兩列取較寬鬆可見性", () => {
    const p = build({
      formRows: [fp(1, 5, ["view", "edit"])],
      fieldRows: [fdp(1, 50, "hidden"), fdp(2, 50, "read")],
      formMeta: [meta(5)],
    })
    expect(p.fieldVisibility(50, 5)).toBe("read")
  })
})

describe("欄位繼承 + 收斂於表單動作集", () => {
  it("欄位缺列 → 繼承(表單有 edit → write)", () => {
    const p = build({ formRows: [fp(1, 5, ["view", "edit"])], formMeta: [meta(5)] })
    expect(p.fieldVisibility(50, 5)).toBe("write")
  })
  it("表單僅 view → 欄位給 write 仍降 read", () => {
    const p = build({
      formRows: [fp(1, 5, ["view"])],
      fieldRows: [fdp(1, 50, "write")],
      formMeta: [meta(5)],
    })
    expect(p.fieldVisibility(50, 5)).toBe("read")
  })
  it("表單無 view → 欄位 hidden", () => {
    const p = build({ fieldRows: [fdp(1, 50, "write")], formMeta: [meta(5)] })
    expect(p.fieldVisibility(50, 5)).toBe("hidden")
  })
})

describe("owner 短路(OQ-4=B:資料動作,design 除外)", () => {
  it("建立者得全資料動作,但無 design", () => {
    const p = build({ actorId: 7, formMeta: [meta(5, { createdBy: 7 })] })
    expect(p.hasAction(5, "edit")).toBe(true)
    expect(p.hasAction(5, "delete")).toBe(true)
    expect(p.hasAction(5, "export")).toBe(true)
    expect(p.hasAction(5, "design")).toBe(false)
    expect(p.canManage(5)).toBe(false)
  })
  it("非建立者不享 owner", () => {
    const p = build({ actorId: 8, formMeta: [meta(5, { createdBy: 7 })] })
    expect(p.canRead(5)).toBe(false)
  })
})

describe("分類繼承(category_permissions)", () => {
  it("表單繼承所屬分類授權", () => {
    const p = build({
      roleIds: [1],
      categoryRows: [cp(1, 9, ["view", "create"])],
      formMeta: [meta(5, { categoryId: 9 })],
    })
    expect([...p.formActions(5)].sort()).toEqual(["create", "view"])
  })

  it("覆寫優先於繼承(per-role):同角色有覆寫則忽略其分類", () => {
    const p = build({
      roleIds: [1],
      formRows: [fp(1, 5, ["view"])],
      categoryRows: [cp(1, 9, ["view", "create", "edit"])],
      formMeta: [meta(5, { categoryId: 9 })],
    })
    expect([...p.formActions(5)]).toEqual(["view"])
  })

  it("角色A覆寫 ∪ 角色B繼承(較寬鬆勝)", () => {
    const p = build({
      roleIds: [1, 2],
      formRows: [fp(1, 5, ["view"])],
      categoryRows: [cp(2, 9, ["view", "create", "edit"])],
      formMeta: [meta(5, { categoryId: 9 })],
    })
    expect([...p.formActions(5)].sort()).toEqual(["create", "edit", "view"])
  })
})

describe("敏感旗標(OQ-5:跳過繼承 + 預設,只認 owner/覆寫)", () => {
  it("敏感表不吃分類繼承 → deny", () => {
    const p = build({
      roleIds: [1],
      categoryRows: [cp(1, 9, ["view", "create"])],
      formMeta: [meta(5, { categoryId: 9, isSensitive: true })],
    })
    expect(p.canRead(5)).toBe(false)
  })
  it("敏感表不吃預設 profile → deny", () => {
    const p = build({
      defaultActions: ["view"],
      formMeta: [meta(5, { isSensitive: true })],
    })
    expect(p.canRead(5)).toBe(false)
  })
  it("敏感表仍認明確覆寫", () => {
    const p = build({
      roleIds: [1],
      formRows: [fp(1, 5, ["view"])],
      formMeta: [meta(5, { isSensitive: true })],
    })
    expect(p.canRead(5)).toBe(true)
  })
  it("敏感表仍認 owner", () => {
    const p = build({ actorId: 7, formMeta: [meta(5, { isSensitive: true, createdBy: 7 })] })
    expect(p.hasAction(5, "edit")).toBe(true)
  })
})

describe("租戶預設 profile(OQ-3:未分類/無授權之非敏感表 baseline)", () => {
  it("空預設 → deny;設 view → 未授權非敏感表可讀", () => {
    expect(build({ formMeta: [meta(5)] }).canRead(5)).toBe(false)
    const p = build({ defaultActions: ["view"], formMeta: [meta(5)] })
    expect(p.canRead(5)).toBe(true)
    expect(p.hasAction(5, "edit")).toBe(false)
  })
  it("有分類授權則不套預設(命中即止)", () => {
    const p = build({
      roleIds: [1],
      categoryRows: [cp(1, 9, ["view", "create", "edit"])],
      defaultActions: ["view"],
      formMeta: [meta(5, { categoryId: 9 })],
    })
    expect([...p.formActions(5)].sort()).toEqual(["create", "edit", "view"])
  })
})

describe("listableForms 三態(OQ-8:可讀 / 鎖定 / 隱藏)", () => {
  it("可讀 → readable;非敏感無權 → locked;敏感無權 → 隱藏", () => {
    const p = build({
      roleIds: [1],
      formRows: [fp(1, 5, ["view"])],
      formMeta: [meta(5), meta(6), meta(7, { isSensitive: true })],
    })
    const { readable, locked } = p.listableForms([5, 6, 7])
    expect(readable).toEqual([5])
    expect(locked).toEqual([6])
  })
  it("admin → 全 readable", () => {
    const p = build({ isAdmin: true })
    expect(p.listableForms([5, 6, 7])).toEqual({ readable: [5, 6, 7], locked: [] })
  })
})

describe("readableFormIds(舊 list 過濾)", () => {
  it("只留有 view 的表單;admin 全留", () => {
    const p = build({
      roleIds: [1],
      formRows: [fp(1, 5, ["view"]), fp(1, 6, ["create"])],
      formMeta: [meta(5), meta(6)],
    })
    expect(p.readableFormIds([5, 6, 7])).toEqual([5])
    expect(build({ isAdmin: true }).readableFormIds([5, 6, 7])).toEqual([5, 6, 7])
  })
})

/* 🔴 OQ-ARI-9|**分類管理員** = 在分類層授予 `design`。

   一手依據(§10-ter):Ragic 以「群組頁籤 + 群組管理員」提供容器層的設計權下放,
   而本模組原本只有「租戶 admin」或「逐表 design 授權」兩種。
   對碼後確認**容器層授 design 本來就走得通**(分類繼承不過濾任何動作)——
   缺的是前端沒有能力來源,授了也看不到入口(見 `/api/authz/me`)。

   這幾條把「走得通」釘住,免得日後有人為了收緊而在繼承層加上動作過濾,
   一加就會把分類管理員這個角色靜默廢掉。 */
describe("OQ-ARI-9 分類管理員(容器層 design)", () => {
  it("分類層授 design → 該分類內的表單繼承得到 design", () => {
    const p = build({
      roleIds: [1],
      categoryRows: [cp(1, 9, ["view", "edit", "design"])],
      formMeta: [meta(5, { categoryId: 9 }), meta(6)],
    })
    expect(p.hasAction(5, "design")).toBe(true)
    /* 不在該分類的表單不受影響 —— 容器層授權的邊界就是那個容器 */
    expect(p.hasAction(6, "design")).toBe(false)
  })

  it("🔴 敏感表不吃分類繼承 —— 分類管理員也拿不到(OQ-ARI-5 之邊界)", () => {
    const p = build({
      roleIds: [1],
      categoryRows: [cp(1, 9, ["view", "design"])],
      formMeta: [meta(7, { categoryId: 9, isSensitive: true })],
    })
    expect(p.hasAction(7, "design")).toBe(false)
  })

  it("逐表覆寫是絕對集,會蓋掉分類給的 design(層 2 優先於層 3)", () => {
    const p = build({
      roleIds: [1],
      categoryRows: [cp(1, 9, ["view", "design"])],
      formRows: [fp(1, 5, ["view"])],
      formMeta: [meta(5, { categoryId: 9 })],
    })
    expect(p.hasAction(5, "design")).toBe(false)
    expect(p.hasAction(5, "view")).toBe(true)
  })
})

/* `/api/authz/me` 的序列化。前端唯一的能力來源,回錯就是畫面說謊。 */
describe("toFormActionMap(/api/authz/me)", () => {
  it("非 admin:逐表列出實際動作", () => {
    const p = build({
      roleIds: [1],
      formRows: [fp(1, 5, ["view", "design"])],
      formMeta: [meta(5), meta(6)],
    })
    const map = p.toFormActionMap()
    expect(map["5"]).toEqual(expect.arrayContaining(["view", "design"]))
    /* 沒有任何動作的表**不出現在 map 裡** —— 回一個空陣列與「沒這個 key」語意相同,
       但少送一筆就少洩漏一張表的存在 */
    expect(map["6"]).toBeUndefined()
  })

  it("🔴 admin 回空物件 —— `isAdmin: true` 已表達一切", () => {
    /* 展開全租戶表單會讓回應大小隨表單數線性成長,
       且把「這個租戶有哪些表」洩漏在一個不需要那份資訊的端點裡。
       ⚠️ 因此前端**必須先看 isAdmin**,否則管理員會被判成什麼都不能做。 */
    expect(build({ isAdmin: true }).toFormActionMap()).toEqual({})
  })
})
