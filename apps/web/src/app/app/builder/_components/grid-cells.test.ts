import type { CellValueType, FieldDto } from "@/lib/engine/schemas"
import { describe, expect, it } from "vitest"
import { gridEditData, gridKind, isGridEditable } from "./grid-cells"

function field(type: CellValueType): FieldDto {
  return { id: 1, name: "f", type, required: false, unique: false, options: {}, position: 0 }
}

describe("grid-cells mapping", () => {
  it("maps types to Glide cell kinds", () => {
    expect(gridKind("text")).toBe("text")
    expect(gridKind("money")).toBe("text") // 保字串精度
    expect(gridKind("date")).toBe("text")
    expect(gridKind("number")).toBe("number")
    expect(gridKind("percent")).toBe("number")
    expect(gridKind("rating")).toBe("number")
    expect(gridKind("checkbox")).toBe("boolean")
  })

  it("marks autoNumber / stub / multiSelect as non-editable in grid", () => {
    expect(isGridEditable(field("text"))).toBe(true)
    expect(isGridEditable(field("money"))).toBe(true)
    expect(isGridEditable(field("autoNumber"))).toBe(false)
    expect(isGridEditable(field("formula"))).toBe(false)
    expect(isGridEditable(field("link"))).toBe(false)
    expect(isGridEditable(field("multiSelect"))).toBe(false)
  })

  it("produces editable data representation per kind", () => {
    expect(gridEditData(field("text"), "hi")).toBe("hi")
    expect(gridEditData(field("text"), null)).toBe("")
    expect(gridEditData(field("money"), "128400.0000")).toBe("128400.0000")
    expect(gridEditData(field("number"), 42)).toBe(42)
    expect(gridEditData(field("checkbox"), true)).toBe(true)
    expect(gridEditData(field("checkbox"), null)).toBe(false)
  })
})
