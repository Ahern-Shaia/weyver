import { z } from "zod"
import { FILTER_OPERATORS } from "../records/record-specs.js"

/* R1·UP-3 2D 設計器版面 metadata(form_def.layout;OQ-FD2-1=A 單一 JSONB 承載整表)。
   版面與資料正交:座標/設定/靜態/分段皆此;DDL/DML 鏈不動。 */

/* 預設值變數(P0 = create-time 集;# 修改時 + $SEQ 為 P1,OQ-FD2-6)*/
export const DEFAULT_VARIABLES = [
  "$DATE",
  "$TIME",
  "$DATETIME",
  "$YEAR",
  "$MONTH",
  "$WEEKDAY",
  "$USERID",
  "$USERNAME",
] as const
export type DefaultVariable = (typeof DEFAULT_VARIABLES)[number]

export const defaultValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.string().max(500) }),
  z.object({ kind: z.literal("variable"), value: z.enum(DEFAULT_VARIABLES) }),
  z.object({ kind: z.literal("formula"), value: z.string().max(2000) }),
])
export type DefaultValue = z.infer<typeof defaultValueSchema>

/* 靜態元素 / 分段之樣式(顯示層) */
const styleSchema = z
  .object({
    font: z.string().max(60).optional(),
    size: z.number().int().min(8).max(72).optional(),
    color: z.string().max(30).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    bg: z.string().max(30).optional(),
  })
  .strict()

/* href/imageUrl 僅允 https 或站內相對路徑(擋 javascript:/data: 等 XSS scheme;SSRF 見 §7-bis) */
const safeUrl = z
  .string()
  .max(2000)
  .refine((u) => /^https:\/\//.test(u) || u.startsWith("/"), "url 僅允 https 或相對路徑")

export const fieldLayoutSchema = z
  .object({
    row: z.number().int().min(0).max(999),
    col: z.number().int().min(0).max(50),
    colSpan: z.number().int().min(1).max(50).optional(),
    sectionId: z.string().max(60).optional(),
    placeholder: z.string().max(200).optional(),
    help: z.string().max(1000).optional(),
    readonly: z.boolean().optional(),
    hidden: z.boolean().optional(),
    defaultValue: defaultValueSchema.optional(),
  })
  .strict()

export const staticElementSchema = z
  .object({
    id: z.string().min(1).max(60),
    kind: z.enum(["text", "image"]),
    row: z.number().int().min(0).max(999),
    col: z.number().int().min(0).max(50),
    colSpan: z.number().int().min(1).max(50).optional(),
    text: z.string().max(5000).optional(),
    markdown: z.boolean().optional(),
    href: safeUrl.optional(),
    imageUrl: safeUrl.optional(),
    designOnly: z.boolean().optional(),
    style: styleSchema.optional(),
  })
  .strict()

export const sectionSchema = z
  .object({
    id: z.string().min(1).max(60),
    name: z.string().max(100),
    fromRow: z.number().int().min(0).max(999),
    toRow: z.number().int().min(0).max(999),
    style: styleSchema.optional(),
  })
  .strict()

/* R1·UP-3b 條件式格式(加法 optional,零 migration)。

   採 Ragic 範式(OQ-CF-1/3/5/7):**表單級**設定、著色**欄位值與標題**(非整列)、
   **後者覆蓋**、記錄頁與列表頁**各自獨立**一組規則。

   條件複用 `FILTER_OPERATORS`(OQ-CF-4)—— 與列表篩選同一組運算子,
   「篩得到的」與「上色的」語意才會一致(FMEA G3)。
   顏色為 12 tone 受控白名單(OQ-CF-2,docs/14 §0.2),**非自由 hex**:
   前端另以查表映射成 class,兩側皆不接受任意值(FMEA G1)。 */
export const FORMAT_TONES = [
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

export const formatConditionSchema = z
  .object({
    field: z.string().min(1).max(100),
    op: z.enum(FILTER_OPERATORS),
    value: z.unknown().optional(),
  })
  .strict()

export const formatRuleSchema = z
  .object({
    combinator: z.enum(["and", "or"]).default("and"),
    conditions: z.array(formatConditionSchema).min(1).max(20),
    /* 套用到哪些欄位(顯示名);空 = 條件所涉之欄位 */
    targets: z.array(z.string().min(1).max(100)).max(50).default([]),
    tone: z.enum(FORMAT_TONES),
  })
  .strict()

export const conditionalFormatsSchema = z
  .object({
    record: z.array(formatRuleSchema).max(20).default([]),
    list: z.array(formatRuleSchema).max(20).default([]),
  })
  .strict()

export type FormatRule = z.infer<typeof formatRuleSchema>
export type ConditionalFormats = z.infer<typeof conditionalFormatsSchema>

export const layoutSchema = z
  .object({
    /* 🔴 樂觀鎖(#109)。整表覆寫下,兩人同改後寫者會蓋掉整張版面。
       未帶時維持舊行為(既有呼叫端與測試不受影響)。 */
    expectedVersion: z.number().int().positive().optional(),
    grid: z
      .object({
        cols: z.number().int().min(1).max(50).default(12),
        rowHeights: z.record(z.string(), z.number().int().min(16).max(400)).optional(),
        colWidths: z.record(z.string(), z.number().int().min(40).max(800)).optional(),
      })
      .default({ cols: 12 }),
    // key = fieldId(字串);PUT 時驗 key ⊆ 該 form 現存 field_def id
    fields: z.record(z.string(), fieldLayoutSchema).default({}),
    statics: z.array(staticElementSchema).max(200).default([]),
    sections: z.array(sectionSchema).max(50).default([]),
    /* R1·後續-2 列印設定(加法 optional,零 migration;OQ-PM-6=A 列範圍語意,承 Ragic doc/149)。
       紙張/邊界/方向刻意不自建 —— 委派瀏覽器列印對話框(OQ-PM-3)。 */
    print: z
      .object({
        headerRows: z.array(z.number().int().min(0).max(999)).max(20).default([]),
        footerRows: z.array(z.number().int().min(0).max(999)).max(20).default([]),
        pageBreakAfterRows: z.array(z.number().int().min(0).max(999)).max(50).default([]),
      })
      .strict()
      .optional(),
    /* R1·UP-3b 條件式格式(見上;optional = 既有表單零遷移) */
    conditionalFormats: conditionalFormatsSchema.optional(),
  })
  .strict()

export type Layout = z.infer<typeof layoutSchema>
