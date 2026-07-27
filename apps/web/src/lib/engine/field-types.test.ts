import { describe, expect, it } from "vitest"
import {
  ADVANCED_TYPES,
  BUILDABLE_TYPES,
  conversionTargets,
  fieldTypeMeta,
  isStubType,
} from "./field-types"
import { CELL_VALUE_TYPES, STUB_TYPES } from "./schemas"

describe("field-types (mirrors backend registry)", () => {
  it("has meta for every backend cell value type", () => {
    for (const type of CELL_VALUE_TYPES) {
      expect(fieldTypeMeta(type).label.length).toBeGreaterThan(0)
    }
  })

  it("buildable types exclude stubs and advanced types", () => {
    expect(BUILDABLE_TYPES).toHaveLength(
      CELL_VALUE_TYPES.length - STUB_TYPES.length - ADVANCED_TYPES.length,
    )
    for (const stub of STUB_TYPES) {
      expect(BUILDABLE_TYPES).not.toContain(stub)
      expect(isStubType(stub)).toBe(true)
    }
    for (const advanced of ADVANCED_TYPES) expect(BUILDABLE_TYPES).not.toContain(advanced)
  })

  it("attachment 已由 F-5 解鎖:非 stub 且可建", () => {
    expect(isStubType("attachment")).toBe(false)
    expect(BUILDABLE_TYPES).toContain("attachment")
  })

  it("conversion targets mirror the safe whitelist", () => {
    expect(conversionTargets("email")).toEqual(["text", "longText"])
    expect(conversionTargets("text")).toEqual(["longText"])
    expect(conversionTargets("money")).toEqual([])
    expect(conversionTargets("number")).toEqual([])
  })

  it("choices / prefix needs flagged for select / autoNumber", () => {
    expect(fieldTypeMeta("singleSelect").needsChoices).toBe(true)
    expect(fieldTypeMeta("multiSelect").needsChoices).toBe(true)
    expect(fieldTypeMeta("autoNumber").needsPrefix).toBe(true)
    expect(fieldTypeMeta("text").needsChoices).toBe(false)
  })
})
