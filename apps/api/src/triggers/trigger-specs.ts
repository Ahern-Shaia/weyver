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

/* 🔴 R1·C-5|定時觸發的形狀。DB 也有同樣的 CHECK —— 兩道都要:
   zod 給得出人看得懂的訊息,CHECK 擋得住繞過 API 的寫入。 */
export const scheduleSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),
  /* 租戶時區的 0–23 時。最小粒度是小時,對齊 Ragic 的「每天 19:00」語意。 */
  hour: z.number().int().min(0).max(23),
  /* weekly:0–6(0 = 週日)· monthly:1–28,**或 0 = 當月最後一天**。
     ⚠️ 上限 28 是刻意的 —— 2 月沒有 29–31 號,讓人選得到一個「有些月份不會發生」
     的日期,等於賣一個會靜默漏跑的設定。月結選 0。 */
  day: z.number().int().min(0).max(28).optional(),
})
export type TriggerSchedule = z.infer<typeof scheduleSchema>

function scheduleShapeOk(s: TriggerSchedule | undefined): boolean {
  if (s === undefined) return true
  if (s.freq === "daily") return s.day === undefined
  if (s.freq === "weekly") return s.day !== undefined && s.day <= 6
  return s.day !== undefined
}

function timingRefine(v: {
  readonly onCreate?: boolean
  readonly onUpdate?: boolean
  readonly schedule?: TriggerSchedule | undefined
}): boolean {
  return v.onCreate === true || v.onUpdate === true || v.schedule !== undefined
}

export const createTriggerBodySchema = z
  .object({
    name: z.string().min(1).max(60),
    onCreate: z.boolean().default(false),
    onUpdate: z.boolean().default(false),
    /* 空 = 任何更新。非空 = 只有這些欄位變了才算(OQ-ET-5) */
    watchFields: z.array(z.string().min(1).max(100)).max(50).default([]),
    conditions: z.array(triggerConditionSchema).max(20).default([]),
    /* 給了就是定時觸發。不給 = 只吃 onCreate / onUpdate。 */
    schedule: scheduleSchema.optional(),
    config: triggerConfigSchema,
    enabled: z.boolean().default(true),
  })
  .refine(timingRefine, { message: "至少要選一個觸發時機", path: ["onCreate"] })
  .refine((v) => scheduleShapeOk(v.schedule), {
    message: "每週要選星期幾、每月要選幾號(0 = 當月最後一天);每日不需要",
    path: ["schedule", "day"],
  })
  /* 🔴 定時側只做 `updateSelf`。`pushTo` 掃一次全表可能建出上千筆記錄,
     而它又跨到別張表 —— 量級問題與授權問題疊在一起,需要獨立裁定。
     **在邊界就明確拒絕,不要讓人設了一個永遠不會跑的東西。** */
  .refine((v) => v.schedule === undefined || v.config.actionType === "updateSelf", {
    message: "定時觸發目前只支援「更新本筆欄位」",
    path: ["config", "actionType"],
  })
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
  /* null = 不是定時觸發 */
  readonly schedule: TriggerSchedule | null
  readonly lastRunAt: string | null
  readonly position: number
  readonly enabled: boolean
  /* 編輯中的版本。上面的 `config` / `conditions` 等是**正在跑的**那一版。 */
  readonly draft: {
    readonly onCreate: boolean
    readonly onUpdate: boolean
    readonly watchFields: readonly string[]
    readonly conditions: readonly { field: string; op: string; value?: unknown }[]
    readonly actionType: TriggerConfig["actionType"]
    readonly config: TriggerConfig
  }
  /* false = 從未發布 → **不會跑**。設計器要講清楚,否則使用者以為它在動。 */
  readonly isPublished: boolean
  readonly hasUnpublishedChanges: boolean
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
