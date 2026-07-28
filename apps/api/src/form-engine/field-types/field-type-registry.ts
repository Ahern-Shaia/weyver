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
  // R1·UP-4b 影像類欄型(jsonb,與 attachment 同契約 → 零 migration;OQ-IS-1/2)
  "image",
  "signature",
  "formula",
  // R1·UP-4 讀時計算 virtual 型別(無物理欄,systemManaged;值讀時注入)
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "lookup",
  "rollup",
  // R1·UP-4 M3 條碼生成(text 儲存,前端渲染 QR/Code128;零 DB 差異)
  "barcode",
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
  /** R1·UP-4 虛擬欄:無物理欄(buildColumn no-op),值於讀取時注入(系統欄/lookup/rollup)。
      baseQuery 不 select、DDL 不建欄;預設 false。 */
  readonly virtual?: boolean
}

/* R1·UP-4 M2 選項顏色 + 連動:加法擴充(colors/parentField/optionParents 皆 optional)。
   valueSchema 仍 z.enum(choices) → 既有表零遷移;連動為前端過濾導引 + 後端仍驗 enum。 */
/* R1·UP-4c 選項配色:**受控 tone 白名單**(非任意字串/hex)。
   狀態色 ok/warn/error/neutral 承載語意;c1–c8 為不帶語意之類別色(docs/14 §0.2)。
   後端收斂為 enum = 縱深第二道:前端另有查表白名單,兩側皆不接受任意值。 */
const CHIP_TONES = [
  "ok",
  "warn",
  "error",
  "neutral",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "c7",
  "c8",
] as const

const choicesSchema = z
  .object({
    choices: z.array(z.string().min(1).max(100)).min(1).max(200),
    // 選項 → 色 token(非 raw hex,對齊 docs/14 §0.2 受控色盤)
    colors: z.record(z.string(), z.enum(CHIP_TONES)).optional(),
    // 連動:依 parentField 當前值過濾本欄可選項(optionParents: 子選項 → 允許之父選項清單)
    parentField: z.string().max(100).optional(),
    optionParents: z.record(z.string(), z.array(z.string().max(100)).max(200)).optional(),
  })
  .strict()
  /* colors 之 key 必須是現存選項:否則選項改名後,舊色會「借屍還魂」套到同名新選項上,
     產生難查的錯色(FMEA C3)。連動選項之 optionParents 同理。 */
  .superRefine((value, ctx) => {
    if (value.colors === undefined) return
    const known = new Set(value.choices)
    for (const key of Object.keys(value.colors)) {
      if (!known.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["colors", key],
          message: `colors 指向不存在的選項:${key}`,
        })
      }
    }
  })

/* 記錄寫入只需要 choices —— **呈現用設定(顏色 / 連動)不得有能力擋住資料輸入**。
   若此處沿用完整 choicesSchema,一個壞掉的顏色值會讓整張表無法存記錄(潛在缺陷,
   於 R1·UP-4c 收緊 colors 為 enum 時發現並修正)。 */
const choicesOnlySchema = z
  .object({ choices: z.array(z.string().min(1).max(100)).min(1).max(200) })
  .loose()

function def(entry: FieldTypeDefinition): FieldTypeDefinition {
  return entry
}

export const FIELD_TYPE_REGISTRY: Readonly<Record<CellValueType, FieldTypeDefinition>> = {
  text: def({
    cellValueType: "text",
    dbFieldType: "text",
    // R1·UP-4 M3 格式遮罩:displayMask 為前端顯示格式化(儲存原值);加法、既有表零遷移
    optionsSchema: z
      .object({
        displayMask: z.string().max(60).optional(),
        // R1·後續-2「以條碼顯示」(Ragic doc/53;QR-only)
        showAsQr: z.boolean().optional(),
      })
      .strict(),
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
      const parsed = choicesOnlySchema.parse(options)
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
      const parsed = choicesOnlySchema.parse(options)
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
        // R1·UP-4 M2 pattern:日期段(yyyy/yyyyMM/yyyyMMdd)+ 重設範圍(counter table)。
        // 無 dateFormat 且 resetScope=none → 沿用全域 PG sequence(向後相容);否則走 counter。
        dateFormat: z.enum(["yyyy", "yyyyMM", "yyyyMMdd"]).optional(),
        resetScope: z.enum(["none", "daily", "monthly", "yearly", "field"]).default("none"),
        resetField: z.string().max(100).optional(),
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
    optionsSchema: z
      .object({
        targetFormId: z.number().int().positive(),
        // R1·UP-4 M2 顯示標籤:呈現 target 之哪些欄(空=首欄)
        displayFields: z.array(z.string().max(100)).max(10).optional(),
      })
      .strict(),
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
  /* R1·UP-4b 圖片欄(OQ-IS-1=A 獨立於 attachment:Ragic 明載為獨立欄型,客戶心智模型如此)。
     契約與 attachment 相同 → file-storage 之綁定 / 配額 / 孤兒回收 / 下載權限鏈零改動即適用。
     張數上限 20(低於 attachment 的 50:圖片單檔大、列表要能掃視)。 */
  image: def({
    cellValueType: "image",
    dbFieldType: "jsonb",
    optionsSchema: z.object({ maxHeightPx: z.number().int().min(40).max(600).optional() }).strict(),
    buildColumn: (t, col) => void t.jsonb(col),
    valueSchema: () =>
      z.array(z.object({ key: z.string().max(500), name: z.string().max(255) })).max(20),
    filterOperators: EMPTINESS,
    systemManaged: false,
  }),
  /* R1·UP-4b 簽名欄(OQ-IS-5=A canvas→PNG 走既有上傳管線)。
     **單張**以 max 1 表達,不另立契約。OQ-IS-8=A:這是「畫押圖片」,不宣稱不可否認性 ——
     合規電子簽章(TWCA)為 R2(docs/23 v6.1 C2);簽核流程另見 actions-approval。 */
  signature: def({
    cellValueType: "signature",
    dbFieldType: "jsonb",
    optionsSchema: z
      .object({
        penColor: z.enum(["ink", "primary"]).optional(),
        heightPx: z.number().int().min(80).max(400).optional(),
      })
      .strict(),
    buildColumn: (t, col) => void t.jsonb(col),
    valueSchema: () =>
      z.array(z.object({ key: z.string().max(500), name: z.string().max(255) })).max(1),
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
  // ── R1·UP-4 虛擬欄(無物理欄;值讀時注入。filterOperators [] = 無欄不可篩/排)──
  createdAt: def({
    cellValueType: "createdAt",
    dbFieldType: "timestamptz",
    optionsSchema: emptyOptions,
    buildColumn: () => undefined,
    valueSchema: () => z.never(),
    filterOperators: [],
    systemManaged: true,
    virtual: true,
  }),
  createdBy: def({
    cellValueType: "createdBy",
    dbFieldType: "bigint",
    optionsSchema: emptyOptions,
    buildColumn: () => undefined,
    valueSchema: () => z.never(),
    filterOperators: [],
    systemManaged: true,
    virtual: true,
  }),
  updatedAt: def({
    cellValueType: "updatedAt",
    dbFieldType: "timestamptz",
    optionsSchema: emptyOptions,
    buildColumn: () => undefined,
    valueSchema: () => z.never(),
    filterOperators: [],
    systemManaged: true,
    virtual: true,
  }),
  updatedBy: def({
    cellValueType: "updatedBy",
    dbFieldType: "bigint",
    optionsSchema: emptyOptions,
    buildColumn: () => undefined,
    valueSchema: () => z.never(),
    filterOperators: [],
    systemManaged: true,
    virtual: true,
  }),
  lookup: def({
    cellValueType: "lookup",
    dbFieldType: "text",
    optionsSchema: z
      .object({
        linkFieldName: z.string().min(1).max(100),
        targetFieldName: z.string().min(1).max(100),
      })
      .strict(),
    buildColumn: () => undefined,
    valueSchema: () => z.never(),
    filterOperators: [],
    systemManaged: true,
    virtual: true,
  }),
  rollup: def({
    cellValueType: "rollup",
    dbFieldType: "numeric",
    optionsSchema: z
      .object({
        childFormId: z.number().int().positive(),
        childFieldName: z.string().min(1).max(100),
        fn: z.enum(["SUM", "COUNT", "AVERAGE", "MIN", "MAX"]),
        condition: z.object({ field: z.string().max(100), equals: z.unknown() }).optional(),
      })
      .strict(),
    buildColumn: () => undefined,
    valueSchema: () => z.never(),
    filterOperators: [],
    systemManaged: true,
    virtual: true,
  }),
  barcode: def({
    cellValueType: "barcode",
    dbFieldType: "text",
    optionsSchema: z.object({ symbology: z.enum(["qr", "code128"]).default("qr") }).strict(),
    buildColumn: (t, col) => void t.text(col),
    valueSchema: () => z.string().max(500).regex(NO_CONTROL_RE),
    filterOperators: TEXTUAL,
    systemManaged: false,
  }),
}

export function fieldType(type: CellValueType): FieldTypeDefinition {
  return FIELD_TYPE_REGISTRY[type]
}
