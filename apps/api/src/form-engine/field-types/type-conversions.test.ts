import { describe, expect, it } from "vitest"
import { isSafeConversion } from "./type-conversions.js"

describe("type conversion whitelist (OQ-FEC-4 = A)", () => {
  it("allows identity and semantic widening on same physical type", () => {
    expect(isSafeConversion("text", "text")).toBe(true)
    expect(isSafeConversion("text", "longText")).toBe(true)
    expect(isSafeConversion("email", "text")).toBe(true)
    expect(isSafeConversion("url", "longText")).toBe(true)
    expect(isSafeConversion("singleSelect", "text")).toBe(true)
  })

  it("rejects narrowing and cross-physical conversions", () => {
    expect(isSafeConversion("longText", "text")).toBe(false)
    expect(isSafeConversion("text", "email")).toBe(false)
    expect(isSafeConversion("money", "text")).toBe(false)
    expect(isSafeConversion("text", "number")).toBe(false)
    expect(isSafeConversion("number", "money")).toBe(false)
    expect(isSafeConversion("rating", "number")).toBe(false)
  })
})
