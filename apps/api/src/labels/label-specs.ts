import { z } from "zod"

/* R1·後續-2 標籤定義 schema(label_def.config)。
   items 為**欄位堆疊序**(非 2D 座標,OQ-PM-2)—— 直配 Ragic 標籤語意(選欄 + 順序 + 每欄樣式)。
   紙張/邊界/方向不在此(委派瀏覽器列印,OQ-PM-3);僅標籤自身尺寸與平舖設定。 */

export const labelItemSchema = z
  .object({
    field: z.string().min(1).max(100),
    /* 顯式指定以 QR 呈現(欄型為 barcode 者亦自動 QR);P0 僅 QR(OQ-PM-4) */
    asQr: z.boolean().optional(),
    style: z
      .object({
        size: z.number().int().min(6).max(48).optional(),
        align: z.enum(["left", "center", "right"]).optional(),
        bold: z.boolean().optional(),
        wrap: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type LabelItem = z.infer<typeof labelItemSchema>

export const labelConfigSchema = z
  .object({
    size: z
      .object({
        widthMm: z.number().min(10).max(297),
        heightMm: z.number().min(10).max(297),
      })
      .strict(),
    /* true = A4 平舖多標籤;false = 一頁一標籤(Ragic「列印時一頁一標籤」語意) */
    tile: z.boolean().default(true),
    gapMm: z.number().min(0).max(50).default(2),
    showFieldNames: z.boolean().default(false),
    /* 數量參照欄:數值欄名,決定每筆記錄印幾張(Ragic 標籤數量參照欄位) */
    copiesField: z.string().max(100).optional(),
    items: z.array(labelItemSchema).min(1).max(30),
  })
  .strict()
export type LabelConfig = z.infer<typeof labelConfigSchema>

export const createLabelBodySchema = z.object({
  name: z.string().min(1).max(60),
  config: labelConfigSchema,
})
export type CreateLabelBody = z.infer<typeof createLabelBodySchema>

export const updateLabelBodySchema = z.object({
  name: z.string().min(1).max(60).optional(),
  config: labelConfigSchema.optional(),
  position: z.number().int().min(0).optional(),
})
export type UpdateLabelBody = z.infer<typeof updateLabelBodySchema>

export interface LabelDto {
  readonly id: number
  readonly formId: number
  readonly name: string
  readonly config: LabelConfig
  readonly position: number
}

/* 批次列印硬上限(OQ-PM-7:明示不靜默截斷) */
export const MAX_LABELS_PER_RUN = 1000
/* 每筆份數夾限(FMEA P6) */
export const MAX_COPIES_PER_RECORD = 99
