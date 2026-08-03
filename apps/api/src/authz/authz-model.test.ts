import { describe, expect, it } from "vitest"
import {
  type FormAction,
  clampFieldToForm,
  defaultFieldVisibility,
  isFormAction,
  maxFieldVisibility,
  requiredActionForMethod,
  unionActions,
} from "./authz-model.js"

const set = (...a: FormAction[]): Set<FormAction> => new Set(a)

describe("unionActions(多角色/祖先繼承取聯集)", () => {
  it("unions two action iterables", () => {
    const u = unionActions(set("view", "create"), set("edit"))
    expect([...u].sort()).toEqual(["create", "edit", "view"])
  })
})

describe("defaultFieldVisibility(欄位缺列繼承表單動作集)", () => {
  it("no view → hidden;有 edit/create → write;僅 view → read", () => {
    expect(defaultFieldVisibility(set())).toBe("hidden")
    expect(defaultFieldVisibility(set("view"))).toBe("read")
    expect(defaultFieldVisibility(set("view", "edit"))).toBe("write")
    expect(defaultFieldVisibility(set("view", "create"))).toBe("write")
  })
})

describe("clampFieldToForm(欄位收斂於表單動作集,較嚴者勝)", () => {
  it("表單無寫動作 → 欄位 write 降為 read", () => {
    expect(clampFieldToForm("write", set("view"))).toBe("read")
    expect(clampFieldToForm("read", set("view"))).toBe("read")
  })
  it("表單無 view → 欄位一律 hidden", () => {
    expect(clampFieldToForm("write", set())).toBe("hidden")
  })
  it("表單有 edit → 欄位 write 保留;但不抬高欄位自身授予", () => {
    expect(clampFieldToForm("write", set("view", "edit"))).toBe("write")
    expect(clampFieldToForm("read", set("view", "edit"))).toBe("read")
    expect(clampFieldToForm("hidden", set("view", "create"))).toBe("hidden")
  })
})

describe("maxFieldVisibility", () => {
  it("takes the looser visibility", () => {
    expect(maxFieldVisibility("hidden", "read")).toBe("read")
    expect(maxFieldVisibility("read", "write")).toBe("write")
    expect(maxFieldVisibility("hidden", "hidden")).toBe("hidden")
  })
})

describe("requiredActionForMethod", () => {
  it("maps HTTP verbs to actions", () => {
    expect(requiredActionForMethod("GET")).toBe("view")
    expect(requiredActionForMethod("HEAD")).toBe("view")
    expect(requiredActionForMethod("POST")).toBe("create")
    expect(requiredActionForMethod("PATCH")).toBe("edit")
    expect(requiredActionForMethod("PUT")).toBe("edit")
    expect(requiredActionForMethod("DELETE")).toBe("delete")
  })
})

describe("isFormAction(儲存值防禦)", () => {
  it("accepts known actions, rejects junk", () => {
    expect(isFormAction("approve")).toBe(true)
    expect(isFormAction("design")).toBe(true)
    expect(isFormAction("bogus")).toBe(false)
  })
})
