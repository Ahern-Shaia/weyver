import { z } from "zod"
import { FILTER_OPERATORS } from "../form-engine/records/record-specs.js"

/* R1·UP-2 視圖組態 schema(view_def.config 之邊界驗證;docs/modules/R1/views-list.md §4.1)。
   欄位一律以「顯示名」表示(Ragic 範式;直接對映 records query API 之 field 名)。
   forcedFilter 刻意不在此(OQ-VL-2:列級安全歸 authz 軸)。 */

export const VIEW_SCOPES = ["personal", "shared"] as const
export type ViewScope = (typeof VIEW_SCOPES)[number]

export const viewFilterConditionSchema = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(FILTER_OPERATORS),
  value: z.unknown().optional(),
})

/* 單層 combinator(OQ-VL-1):AND|OR 覆於扁平條件;巢狀 groups 留 P1 */
export const viewFilterSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  conditions: z.array(viewFilterConditionSchema).max(20).default([]),
})
export type ViewFilter = z.infer<typeof viewFilterSchema>

export const viewSortSchema = z.object({
  field: z.string().min(1).max(100),
  dir: z.enum(["asc", "desc"]).default("asc"),
})

export const viewConfigSchema = z.object({
  // 選欄 + 順序(空 = 全 readable 欄;maskRead 後端硬底,view 只能收窄)
  fields: z.array(z.string().min(1).max(100)).max(200).default([]),
  filter: viewFilterSchema.default({ combinator: "and", conditions: [] }),
  sorts: z.array(viewSortSchema).max(5).default([]),
  search: z.string().max(200).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
})
export type ViewConfig = z.infer<typeof viewConfigSchema>

export const createViewBodySchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(VIEW_SCOPES).default("personal"),
  config: viewConfigSchema,
  isDefault: z.boolean().default(false),
  locked: z.boolean().default(false),
})
export type CreateViewBody = z.infer<typeof createViewBodySchema>

export const updateViewBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: viewConfigSchema.optional(),
  scope: z.enum(VIEW_SCOPES).optional(),
  isDefault: z.boolean().optional(),
  locked: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
})
export type UpdateViewBody = z.infer<typeof updateViewBodySchema>

export interface ViewDto {
  readonly id: number
  readonly formId: number
  readonly name: string
  readonly scope: ViewScope
  readonly isDefault: boolean
  readonly locked: boolean
  readonly config: ViewConfig
  readonly position: number
  readonly createdBy: number | null
  readonly updatedAt: string
}
