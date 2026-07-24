import { z } from "zod"

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

export const layoutSchema = z
  .object({
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
  })
  .strict()

export type Layout = z.infer<typeof layoutSchema>
