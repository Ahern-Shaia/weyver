import knex from "knex"
import { describe, expect, it } from "vitest"
import {
  CELL_VALUE_TYPES,
  FIELD_TYPE_REGISTRY,
  fieldType,
  type CellValueType,
} from "./field-type-registry.js"

const k = knex({ client: "pg" })

function ddlFor(type: CellValueType, options: Record<string, unknown> = {}): string {
  const builder = k.schema.createTable("spec_t", (table) => {
    fieldType(type).buildColumn(table, "f1", options)
  })
  const statements = builder.toSQL()
  return statements.map((s) => s.sql).join("; ")
}

describe("field type registry", () => {
  it("covers all MVP cell value types", () => {
    expect(Object.keys(FIELD_TYPE_REGISTRY).sort()).toEqual([...CELL_VALUE_TYPES].sort())
  })

  it("every entry declares consistent cellValueType", () => {
    for (const type of CELL_VALUE_TYPES) {
      expect(FIELD_TYPE_REGISTRY[type].cellValueType).toBe(type)
    }
  })

  it("money maps to numeric(19,4) — 鐵則 2", () => {
    expect(FIELD_TYPE_REGISTRY.money.dbFieldType).toBe("numeric")
    expect(ddlFor("money")).toContain('"f1" decimal(19, 4)')
  })

  it("physical DDL per type", () => {
    expect(ddlFor("text")).toContain('"f1" text')
    expect(ddlFor("dateTime")).toContain("timestamptz")
    expect(ddlFor("multiSelect")).toContain("text[]")
    expect(ddlFor("checkbox")).toContain("boolean")
    expect(ddlFor("rating")).toContain("int2")
    expect(ddlFor("member")).toContain("bigint")
    expect(ddlFor("attachment")).toContain("jsonb")
  })

  it("columns are always nullable — 禁 rewrite 型 DDL(spike S2)", () => {
    for (const type of CELL_VALUE_TYPES) {
      const options =
        type === "singleSelect" || type === "multiSelect"
          ? { choices: [{ id: "oaaaaaaa1", name: "a" }] }
          : type === "link"
            ? { targetFormId: 1 }
            : type === "formula"
              ? { expression: "1+1" }
              : {}
      const sql = ddlFor(type, options)
      expect(sql).not.toMatch(/not null/i)
      expect(sql).not.toMatch(/default/i)
    }
  })

  it("money value schema accepts decimal string, rejects float-ish input", () => {
    const schema = FIELD_TYPE_REGISTRY.money.valueSchema({})
    expect(schema.safeParse("1234.5678").success).toBe(true)
    expect(schema.safeParse("-99").success).toBe(true)
    expect(schema.safeParse(1234.5678).success).toBe(false)
    expect(schema.safeParse("12.34567").success).toBe(false)
    expect(schema.safeParse("1e5").success).toBe(false)
  })

  it("singleSelect value schema enforces choices", () => {
    /* valueSchema 收的是**已儲存**的 options,恆為 v2(建表時經 normalizedOptions 正規化) */
    const schema = FIELD_TYPE_REGISTRY.singleSelect.valueSchema({
      choices: [
        { id: "oaaaaaaa1", name: "紅" },
        { id: "oaaaaaaa2", name: "綠" },
      ],
    })
    expect(schema.safeParse("紅").success).toBe(true)
    expect(schema.safeParse("藍").success).toBe(false)
  })

  it("system-managed types reject user writes", () => {
    for (const type of ["autoNumber", "formula"] as const) {
      expect(FIELD_TYPE_REGISTRY[type].systemManaged).toBe(true)
      expect(FIELD_TYPE_REGISTRY[type].valueSchema({}).safeParse("anything").success).toBe(false)
    }
  })

  it("options schemas reject unknown keys", () => {
    expect(FIELD_TYPE_REGISTRY.text.optionsSchema.safeParse({ evil: 1 }).success).toBe(false)
    expect(FIELD_TYPE_REGISTRY.rating.optionsSchema.safeParse({ max: 11 }).success).toBe(false)
    expect(FIELD_TYPE_REGISTRY.singleSelect.optionsSchema.safeParse({ choices: [] }).success).toBe(
      false,
    )
  })

  it("date/dateTime accept ISO only", () => {
    expect(FIELD_TYPE_REGISTRY.date.valueSchema({}).safeParse("2026-07-19").success).toBe(true)
    expect(FIELD_TYPE_REGISTRY.date.valueSchema({}).safeParse("07/19/2026").success).toBe(false)
    expect(
      FIELD_TYPE_REGISTRY.dateTime.valueSchema({}).safeParse("2026-07-19T10:00:00+08:00").success,
    ).toBe(true)
  })
})
