import { describe, expect, it } from "vitest"
import {
  canManageForm,
  canReadForm,
  canWriteForm,
  clampFieldToForm,
  maxFieldVisibility,
  maxFormLevel,
  requiredLevelForMethod,
} from "./authz-model.js"

describe("authz form-level union (多角色/祖先繼承取最寬鬆)", () => {
  it("picks the higher of two levels", () => {
    expect(maxFormLevel("none", "read")).toBe("read")
    expect(maxFormLevel("read", "write")).toBe("write")
    expect(maxFormLevel("manage", "read")).toBe("manage")
    expect(maxFormLevel("write", "write")).toBe("write")
  })

  it("field visibility union", () => {
    expect(maxFieldVisibility("hidden", "read")).toBe("read")
    expect(maxFieldVisibility("read", "write")).toBe("write")
    expect(maxFieldVisibility("hidden", "hidden")).toBe("hidden")
  })
})

describe("authz field clamps to form level (交集,較嚴者勝)", () => {
  it("caps field write when form is only read", () => {
    expect(clampFieldToForm("write", "read")).toBe("read")
    expect(clampFieldToForm("read", "read")).toBe("read")
  })

  it("form none hides all fields regardless of field grant", () => {
    expect(clampFieldToForm("write", "none")).toBe("hidden")
    expect(clampFieldToForm("read", "none")).toBe("hidden")
  })

  it("does not raise field above its own grant", () => {
    expect(clampFieldToForm("hidden", "manage")).toBe("hidden")
    expect(clampFieldToForm("read", "write")).toBe("read")
    expect(clampFieldToForm("write", "manage")).toBe("write")
  })
})

describe("authz level predicates", () => {
  it("read/write/manage gates", () => {
    expect(canReadForm("none")).toBe(false)
    expect(canReadForm("read")).toBe(true)
    expect(canWriteForm("read")).toBe(false)
    expect(canWriteForm("write")).toBe(true)
    expect(canManageForm("write")).toBe(false)
    expect(canManageForm("manage")).toBe(true)
  })
})

describe("required level per HTTP method", () => {
  it("GET/HEAD need read; mutations need write", () => {
    expect(requiredLevelForMethod("GET")).toBe("read")
    expect(requiredLevelForMethod("HEAD")).toBe("read")
    expect(requiredLevelForMethod("POST")).toBe("write")
    expect(requiredLevelForMethod("PATCH")).toBe("write")
    expect(requiredLevelForMethod("DELETE")).toBe("write")
  })
})
