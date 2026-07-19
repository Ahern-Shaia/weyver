import type { Knex } from "knex"
import { z } from "zod"

/* A2|欄位型別系統:雙軸(cellValueType 語意 / dbFieldType 物理)+ visitor(docs/16 Teable pattern 借鏡,自研)
   新型別 = 加一個 registry entry,不改 DDL / DML 服務(OQ-FEC-3)。 */

export const CELL_VALUE_TYPES = [
  "text",
  "longText",
  "email",
  "url",
  "phone",
  "number",
  "money",
  "percent",
  "date",
  "dateTime",
  "singleSelect",
  "multiSelect",
  "checkbox",
  "rating",
  "autoNumber",
  "member",
  "link",
  "attachment",
  "formula",
] as const

export type CellValueType = (typeof CELL_VALUE_TYPES)[number]

export type DbFieldType =
  | "text"
  | "numeric"
  | "date"
  | "timestamptz"
  | "boolean"
  | "int2"
  | "bigint"
  | "text_array"
  | "jsonb"

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "anyOf"
  | "isEmpty"
  | "isNotEmpty"

const EMPTINESS = ["isEmpty", "isNotEmpty"] as const
const EQUALITY = ["eq", "neq", ...EMPTINESS] as const
const ORDERED = [...EQUALITY, "gt", "gte", "lt", "lte"] as const
const TEXTUAL = [...EQUALITY, "contains"] as const

/* 金額以十進位字串過邊界,禁 float(鐵則 2) */
const DECIMAL_RE = /^-?\d{1,15}(\.\d{1,4})?$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: 刻意排除控制字元的安全驗證
const NO_CONTROL_RE = /^[^\u0000-\u001F\u007F]*$/u

const emptyOptions = z.object({}).strict()

export interface FieldTypeDefinition {
  readonly cellValueType: CellValueType
  readonly dbFieldType: DbFieldType
  readonly optionsSchema: z.ZodType
  /** 純 nullable 加欄(禁 rewrite 型 DDL,spike S2 結論);NOT NULL / UNIQUE 由 DML 層與部分索引處理 */
  readonly buildColumn: (
    table: Knex.CreateTableBuilder | Knex.AlterTableBuilder,
    physicalColumn: string,
    options: Record<string, unknown>,
  ) => void
  /** 記錄值(寫入邊界)的基礎驗證;requiredness 於 DML 層疊加 */
  readonly valueSchema: (options: Record<string, unknown>) => z.ZodType
  readonly filterOperators: readonly FilterOperator[]
  /** 系統維護欄(autoNumber / formula):拒絕使用者寫入 */
  readonly systemManaged: boolean
}

const choicesSchema = z
  .object({ choices: z.array(z.string().min(1).max(100)).min(1).max(200) })
  .strict()

function def(entry: FieldTypeDefinition): FieldTypeDefinition {
  return entry
}

export const FIELD_TYPE_REGISTRY: Readonly<Record<CellValueType, FieldTypeDefinition>> = {
  text: def({
    cellValueType: "text",
    dbFieldType: "text",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.text(col),
    valueSchema: () => z.string().max(1000).regex(NO_CONTROL_RE),
    filterOperators: TEXTUAL,
    systemManaged: false,
  }),
  longText: def({
    cellValueType: "longText",
    dbFieldType: "text",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.text(col),
    valueSchema: () => z.string().max(100_000),
    filterOperators: TEXTUAL,
    systemManaged: false,
  }),
  email: def({
    cellValueType: "email",
    dbFieldType: "text",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.text(col),
    valueSchema: () => z.email().max(320),
    filterOperators: TEXTUAL,
    systemManaged: false,
  }),
  url: def({
    cellValueType: "url",
    dbFieldType: "text",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.text(col),
    valueSchema: () => z.url().max(2000),
    filterOperators: TEXTUAL,
    systemManaged: false,
  }),
  phone: def({
    cellValueType: "phone",
    dbFieldType: "text",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.text(col),
    valueSchema: () =>
      z
        .string()
        .max(30)
        .regex(/^[+\d()\-\s#]*$/),
    filterOperators: TEXTUAL,
    systemManaged: false,
  }),
  number: def({
    cellValueType: "number",
    dbFieldType: "numeric",
    optionsSchema: z.object({ precision: z.number().int().min(0).max(10).optional() }).strict(),
    buildColumn: (t, col) => void t.decimal(col, 38, 10),
    valueSchema: () => z.number().finite(),
    filterOperators: ORDERED,
    systemManaged: false,
  }),
  money: def({
    cellValueType: "money",
    dbFieldType: "numeric",
    optionsSchema: z.object({ currency: z.string().length(3).default("TWD") }).strict(),
    // 鐵則 2:金額 numeric(19,4),邊界收十進位字串
    buildColumn: (t, col) => void t.decimal(col, 19, 4),
    valueSchema: () => z.string().regex(DECIMAL_RE),
    filterOperators: ORDERED,
    systemManaged: false,
  }),
  percent: def({
    cellValueType: "percent",
    dbFieldType: "numeric",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.decimal(col, 9, 4),
    valueSchema: () => z.number().finite(),
    filterOperators: ORDERED,
    systemManaged: false,
  }),
  date: def({
    cellValueType: "date",
    dbFieldType: "date",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.date(col),
    valueSchema: () => z.iso.date(),
    filterOperators: ORDERED,
    systemManaged: false,
  }),
  dateTime: def({
    cellValueType: "dateTime",
    dbFieldType: "timestamptz",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.timestamp(col, { useTz: true }),
    valueSchema: () => z.iso.datetime({ offset: true }),
    filterOperators: ORDERED,
    systemManaged: false,
  }),
  singleSelect: def({
    cellValueType: "singleSelect",
    dbFieldType: "text",
    optionsSchema: choicesSchema,
    buildColumn: (t, col) => void t.text(col),
    valueSchema: (options) => {
      const parsed = choicesSchema.parse(options)
      return z.enum(parsed.choices as [string, ...string[]])
    },
    filterOperators: [...EQUALITY, "anyOf"],
    systemManaged: false,
  }),
  multiSelect: def({
    cellValueType: "multiSelect",
    dbFieldType: "text_array",
    optionsSchema: choicesSchema,
    buildColumn: (t, col) => void t.specificType(col, "text[]"),
    valueSchema: (options) => {
      const parsed = choicesSchema.parse(options)
      return z.array(z.enum(parsed.choices as [string, ...string[]])).max(200)
    },
    filterOperators: [...EMPTINESS, "anyOf"],
    systemManaged: false,
  }),
  checkbox: def({
    cellValueType: "checkbox",
    dbFieldType: "boolean",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.boolean(col),
    valueSchema: () => z.boolean(),
    filterOperators: EQUALITY,
    systemManaged: false,
  }),
  rating: def({
    cellValueType: "rating",
    dbFieldType: "int2",
    optionsSchema: z.object({ max: z.number().int().min(1).max(10).default(5) }).strict(),
    buildColumn: (t, col) => void t.specificType(col, "int2"),
    valueSchema: (options) => {
      const max = z.object({ max: z.number().int().default(5) }).parse(options).max
      return z.number().int().min(0).max(max)
    },
    filterOperators: ORDERED,
    systemManaged: false,
  }),
  autoNumber: def({
    cellValueType: "autoNumber",
    dbFieldType: "text",
    optionsSchema: z
      .object({
        prefix: z.string().max(20).regex(NO_CONTROL_RE).default(""),
        width: z.number().int().min(3).max(10).default(4),
      })
      .strict(),
    buildColumn: (t, col) => void t.text(col),
    valueSchema: () => z.never(),
    filterOperators: TEXTUAL,
    systemManaged: true,
  }),
  member: def({
    cellValueType: "member",
    dbFieldType: "bigint",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.bigint(col),
    valueSchema: () => z.number().int().positive(),
    filterOperators: EQUALITY,
    systemManaged: false,
  }),
  link: def({
    cellValueType: "link",
    dbFieldType: "bigint",
    optionsSchema: z.object({ targetFormId: z.number().int().positive() }).strict(),
    buildColumn: (t, col) => void t.bigint(col),
    valueSchema: () => z.number().int().positive(),
    filterOperators: EQUALITY,
    systemManaged: false,
  }),
  attachment: def({
    cellValueType: "attachment",
    dbFieldType: "jsonb",
    optionsSchema: emptyOptions,
    buildColumn: (t, col) => void t.jsonb(col),
    valueSchema: () =>
      z.array(z.object({ key: z.string().max(500), name: z.string().max(255) })).max(50),
    filterOperators: EMPTINESS,
    systemManaged: false,
  }),
  formula: def({
    cellValueType: "formula",
    dbFieldType: "numeric",
    optionsSchema: z.object({ expression: z.string().max(2000) }).strict(),
    buildColumn: (t, col) => void t.decimal(col, 38, 10),
    valueSchema: () => z.never(),
    filterOperators: ORDERED,
    systemManaged: true,
  }),
}

export function fieldType(type: CellValueType): FieldTypeDefinition {
  return FIELD_TYPE_REGISTRY[type]
}
