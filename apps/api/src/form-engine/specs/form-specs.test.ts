import { describe, expect, it } from "vitest"
import { addFieldSpecSchema, createFormSpecSchema } from "./form-specs.js"

describe("form specs", () => {
  it("accepts a valid create-form spec", () => {
    const result = createFormSpecSchema.safeParse({
      name: "採購單",
      fields: [
        { name: "單號", type: "autoNumber", options: { prefix: "PO-" } },
        { name: "金額", type: "money" },
        { name: "交期", type: "date" },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.fields[0]?.required).toBe(false)
      // spec 層只驗證;預設值正規化在 catalog 層(normalizedOptions,整合測試覆蓋)
      expect(result.data.fields[0]?.options).toEqual({ prefix: "PO-" })
    }
  })

  it("rejects control characters / overlong / empty names", () => {
    expect(
      createFormSpecSchema.safeParse({ name: "a\u0000b", fields: [{ name: "x", type: "text" }] })
        .success,
    ).toBe(false)
    expect(
      createFormSpecSchema.safeParse({
        name: "a".repeat(101),
        fields: [{ name: "x", type: "text" }],
      }).success,
    ).toBe(false)
    expect(
      createFormSpecSchema.safeParse({ name: "  ", fields: [{ name: "x", type: "text" }] }).success,
    ).toBe(false)
  })

  it("rejects unknown field type and invalid per-type options", () => {
    expect(addFieldSpecSchema.safeParse({ name: "x", type: "hacker" }).success).toBe(false)
    expect(
      addFieldSpecSchema.safeParse({ name: "x", type: "singleSelect", options: {} }).success,
    ).toBe(false)
    expect(
      addFieldSpecSchema.safeParse({ name: "x", type: "text", options: { junk: 1 } }).success,
    ).toBe(false)
  })

  it("rejects duplicate field names", () => {
    const result = createFormSpecSchema.safeParse({
      name: "f",
      fields: [
        { name: "同名", type: "text" },
        { name: "同名", type: "number" },
      ],
    })
    expect(result.success).toBe(false)
  })
})
