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

/* lookup 是否為快照模式(有物理欄、值寫入時固化)。options 可能來自 DB 尚未 parse,故寬鬆讀。 */
export function isSnapshotLookup(options: unknown): boolean {
  return (
    typeof options === "object" &&
    options !== null &&
    (options as { syncMode?: unknown }).syncMode === "snapshot"
  )
}

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

/* 🔴 選項身分模型 v2(#105 追溯稽核,深研見 field-types-parity.md §0-ter C)。

   **v1 的結構缺陷**|`{choices: string[], colors: Record<選項名,色>, optionParents: Record<名,名[]>}`
   —— 值即名稱、呈現設定以名稱為 key。改名後既有記錄留舊字串變孤兒;
   舊色會「借屍還魂」套到同名新選項上(v1 靠 superRefine 驗證去補,是拿驗證補結構缺陷)。

   **v2 = 業界的設計 B**|choice 物件帶**內部 stable id**當錨點,**但資料欄仍存名稱**,改名時同交易改寫資料。
   同為真實表架構的 **Teable 與 NocoDB 都是這個做法**;走「資料欄存 option id」的是 Baserow,
   代價是 `SELECT *` 得到 `f123_id = 87`、多選欄根本不在該表上 —— 那會摧毀「真實表可直接查詢/報表」的架構賣點,
   也讓 AI 無法從 `已驗收` 推斷語意(退化成 `opt_a3f9`)。
   color / parents 收進 choice 物件以 id 為錨 → **借屍還魂從結構上不可能發生,驗證規則因此退場**。

   id 不曝露給使用者、不進資料欄;它的另一個用途是留 i18n 退路
   (日後可加 `labels: Record<locale,string>` 而不動資料欄)。 */
const choiceSchema = z
  .object({
    id: z.string().regex(/^o[0-9a-z]{8}$/),
    name: z.string().trim().min(1).max(100),
    // 色 token(非 raw hex,對齊 docs/14 §0.2 受控色盤)
    color: z.enum(CHIP_TONES).optional(),
    /* 軟停用:新記錄不可選,既有值保留可讀可篩選可分組(Salesforce inactive picklist 語意)。
       Salesforce 的教訓一併抄:停用值**仍須出現在篩選/分組/顏色的可選清單**,
       否則會複製其 report bucket 靜默掉值的事故;且停用值計入總上限,
       免得走上 Salesforce 被迫追加 4000 硬上限的路。 */
    retired: z.boolean().optional(),
    // 連動:允許本選項出現時,父欄需為哪些選項(存父欄的 option id,非名稱)
    parents: z.array(z.string()).max(200).optional(),
  })
  .strict()

/* **id 是內部細節,不該要求呼叫端發明。**
   建表 / 加欄 / Excel 匯入 / Ragic 遷入手上只有名稱字串,強迫它們生 id 等於把實作外洩到 API。
   故此處吃三種輸入並一律正規化成 v2:
     (a) `["甲","乙"]`                       —— 最常見(匯入 / 快速建表)
     (b) `[{name:"甲"}, ...]`                —— 有 color 但還沒有 id
     (c) `[{id:"o…",name:"甲"}, ...]`        —— 完整 v2(改名偵測靠這個 id)
   同時吸收 v1 的兩張以名稱為 key 的 side map(`colors` / `optionParents`)並摺進 choice 物件。
   ⚠️ 沒帶 id 的輸入每次都會生新 id → **改選項一律走 `/options` 端點**(那裡要求帶 id),
   不要用 `/type` 改選項,否則每次都被判成「全刪全建」。 */
const OPTION_ID_RE = /^o[0-9a-z]{8}$/

function mintOptionId(): string {
  return `o${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`
}

const rawChoicesShape = z.preprocess((input) => {
  if (typeof input !== "object" || input === null) return input
  const raw = input as Record<string, unknown>
  if (!Array.isArray(raw.choices)) return input

  const colors = (raw.colors ?? {}) as Record<string, string>
  const parents = (raw.optionParents ?? {}) as Record<string, string[]>
  const nameToId = new Map<string, string>()
  const choices = raw.choices.map((item) => {
    const base =
      typeof item === "string" ? { name: item } : ((item ?? {}) as Record<string, unknown>)
    const name = typeof base.name === "string" ? base.name.trim() : ""
    const id = typeof base.id === "string" && OPTION_ID_RE.test(base.id) ? base.id : mintOptionId()
    nameToId.set(name, id)
    const color = base.color ?? colors[name]
    return {
      ...base,
      id,
      name,
      ...(color === undefined ? {} : { color }),
    }
  })

  /* v1 的 optionParents 以名稱為 key,轉成 choice 內的父 option id 陣列 */
  const withParents = choices.map((c: Record<string, unknown>) => {
    if (c.parents !== undefined) return c
    const fromV1 = parents[c.name as string]
    if (fromV1 === undefined) return c
    return { ...c, parents: fromV1.map((p) => nameToId.get(p) ?? p) }
  })

  const { colors: _c, optionParents: _p, ...rest } = raw
  return { ...rest, choices: withParents }
}, z.looseObject({}))

const choicesSchema = rawChoicesShape
  .pipe(
    z
      .object({
        // active + retired 合計上限,不分開算
        choices: z.array(choiceSchema).min(1).max(200),
        parentField: z.string().max(100).optional(),
      })
      .strict(),
  )
  .superRefine((value, ctx) => {
    /* 名稱 case-insensitive 唯一(對齊 Notion「Names must be unique (case-insensitive)」)。
       比對範圍**含 retired** —— 否則停用「舊分類」後再建同名選項,兩者在資料欄裡無法區分。 */
    const seen = new Set<string>()
    for (const [i, choice] of value.choices.entries()) {
      const key = choice.name.toLowerCase()
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choices", i, "name"],
          message: `選項名稱重複(不分大小寫):${choice.name}`,
        })
      }
      seen.add(key)
    }
  })

/* 記錄寫入只需要 choices —— **呈現用設定(顏色 / 連動)不得有能力擋住資料輸入**。
   若此處沿用完整 choicesSchema,一個壞掉的顏色值會讓整張表無法存記錄(潛在缺陷,
   於 R1·UP-4c 收緊 colors 為 enum 時發現並修正)。 */
const choicesOnlySchema = z
  .object({
    choices: z.array(z.object({ name: z.string().min(1).max(100) }).loose()).min(1).max(200),
  })
  .loose()

/* 值域**含 retired**,這是刻意的。
   失敗不對稱:若拒收 retired,前端存檔會送出整份欄位值 → **持有停用值的記錄從此存不了檔**
   (使用者感受是「系統壞了」,高傷害);若接受,最壞情況只是有人繞過 UI 選了停用值
   —— 值仍在選項清單裡、看得見、可還原,低傷害。選失敗可見的那一邊。
   「新記錄不可選 retired」由選單只列 active 達成。 */
function choiceNames(options: Record<string, unknown>): [string, ...string[]] {
  const parsed = choicesOnlySchema.parse(options)
  return parsed.choices.map((c) => c.name) as [string, ...string[]]
}

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
    valueSchema: (options) => z.enum(choiceNames(options)),
    filterOperators: [...EQUALITY, "anyOf"],
    systemManaged: false,
  }),
  multiSelect: def({
    cellValueType: "multiSelect",
    dbFieldType: "text_array",
    optionsSchema: choicesSchema,
    buildColumn: (t, col) => void t.specificType(col, "text[]"),
    valueSchema: (options) => z.array(z.enum(choiceNames(options))).max(200),
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
    /* 🔴 E-1 指派(OQ-DP-5=A):承 Ragic —— 欄位上一個勾選,**資料即權限**。
       負責業務就寫在這個欄位,不必另外維護一份指派表(兩者必然不同步)。
       勾了之後,寫入記錄時該欄的值會同步到系統欄 assignees(RLS policy 讀那個)。 */
    optionsSchema: z.object({ grantsAccess: z.boolean().optional() }).strict(),
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
        /* 🔴 #113 lookup 的 live vs snapshot(docs/modules/R1/field-types-parity.md §0-ter A)。
           **schema 預設 live** —— 既有欄位無此鍵,預設值必須維持既有語意,否則等於靜默改寫
           所有既有單據的行為。設計器對**新欄**建議 snapshot(業界多數:Ragic / FileMaker /
           Dataverse / SAP 皆為快照;全 live 的是 Airtable 那一派,其社群長年抱怨歷史單據被改寫)。 */
        syncMode: z.enum(["live", "snapshot"]).default("live"),
      })
      .strict(),
    /* snapshot 模式要有物理欄才存得住值;live 維持虛擬欄(無欄、讀時算)。 */
    buildColumn: (t, col, options) =>
      isSnapshotLookup(options) ? void t.text(col) : undefined,
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
