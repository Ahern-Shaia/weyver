import { describe, expect, it } from "vitest"
import {
  IDENTIFIER_RE,
  IdentifierError,
  physicalColumnName,
  physicalTableName,
} from "./identifiers.js"

describe("identifiers", () => {
  it("generates t{id} / f{id}", () => {
    expect(physicalTableName(42)).toBe("t42")
    expect(physicalColumnName(317)).toBe("f317")
  })

  it("rejects non-positive / unsafe ids", () => {
    expect(() => physicalTableName(0)).toThrow(IdentifierError)
    expect(() => physicalTableName(-1)).toThrow(IdentifierError)
    expect(() => physicalTableName(1.5)).toThrow(IdentifierError)
    expect(() => physicalColumnName(Number.MAX_SAFE_INTEGER + 1)).toThrow(IdentifierError)
  })

  it("regex rejects user-supplied identifier shapes", () => {
    for (const bad of ["Robert'); DROP TABLE", "t1; --", "T1", "1t", "a".repeat(64), ""]) {
      expect(IDENTIFIER_RE.test(bad)).toBe(false)
    }
    expect(IDENTIFIER_RE.test("t1")).toBe(true)
    expect(IDENTIFIER_RE.test("f9999")).toBe(true)
  })
})
