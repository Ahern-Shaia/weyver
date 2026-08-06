import { z } from "zod"

import { valueSourceSchema } from "../actions/action-specs.js"

/* R1·C-4|事件觸發器的邊界 schema。

   ## 🔴 動作沿用 `action-specs.ts` 的值來源,不自己寫一份

   `valueSourceSchema`(literal / field / variable)已經是封閉列舉且
   `compileValues` 已經是確定性編譯。觸發器再寫一份的話,兩份會漂移,
   而漂移的形態是「按鈕設得起來的值,觸發器設不起來」—— 使用者看不出為什麼。

   ## 動作集合比按鈕**小**,所以是子集不是同一個 union

   `openUrl` 不可用:沒有人在場,沒有瀏覽器可以開。
   這一點寫在 schema 而不只寫在 DB CHECK —— 邊界要在拒絕得最早的地方拒絕。 */

export const triggerConfigSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("updateSelf"),
    setFields: z.record(z.string().max(100), valueSourceSchema),
  }),
  z.object({
    actionType: z.literal("pushTo"),
    targetFormId: z.number().int().positive(),
    fieldMap: z.record(z.string().max(100), valueSourceSchema),
  }),
])
export type TriggerConfig = z.infer<typeof triggerConfigSchema>

/* 條件:與條件式格式**同一個形狀**(`@weyver/rules` 的 `FormatCondition`)。
   此處只做邊界驗證,求值由共用套件負責 —— 判斷只有一份。 */
export const triggerConditionSchema = z.object({
  field: z.string().min(1).max(100),
  op: z.string().min(1).max(30),
  value: z.unknown().optional(),
})

const timingRefine = <T extends { onCreate?: boolean; onUpdate?: boolean }>(v: T): boolean =>
  v.onCreate === true || v.onUpdate === true

export const createTriggerBodySchema = z
  .object({
    name: z.string().min(1).max(60),
    onCreate: z.boolean().default(false),
    onUpdate: z.boolean().default(false),
    /* 空 = 任何更新。非空 = 只有這些欄位變了才算(OQ-ET-5) */
    watchFields: z.array(z.string().min(1).max(100)).max(50).default([]),
    conditions: z.array(triggerConditionSchema).max(20).default([]),
    config: triggerConfigSchema,
    enabled: z.boolean().default(true),
  })
  .refine(timingRefine, { message: "至少要選一個觸發時機", path: ["onCreate"] })
export type CreateTriggerBody = z.infer<typeof createTriggerBodySchema>

export const updateTriggerBodySchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    onCreate: z.boolean().optional(),
    onUpdate: z.boolean().optional(),
    watchFields: z.array(z.string().min(1).max(100)).max(50).optional(),
    conditions: z.array(triggerConditionSchema).max(20).optional(),
    config: triggerConfigSchema.optional(),
    position: z.number().int().min(0).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
export type UpdateTriggerBody = z.infer<typeof updateTriggerBodySchema>

export interface TriggerDto {
  readonly id: number
  readonly formId: number
  readonly name: string
  readonly onCreate: boolean
  readonly onUpdate: boolean
  readonly watchFields: readonly string[]
  readonly conditions: readonly z.infer<typeof triggerConditionSchema>[]
  readonly actionType: TriggerConfig["actionType"]
  readonly config: TriggerConfig
  readonly position: number
  readonly enabled: boolean
}

export const TRIGGER_OUTCOMES = ["ran", "skipped", "denied", "failed", "depth"] as const
export type TriggerOutcome = (typeof TRIGGER_OUTCOMES)[number]

export interface TriggerRunDto {
  readonly id: number
  readonly triggerId: number
  readonly triggerName: string
  readonly recordId: number
  readonly outcome: TriggerOutcome
  readonly detail: Record<string, unknown> | null
  readonly createdAt: string
}
