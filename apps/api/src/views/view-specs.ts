import { z } from "zod"
import {
  aggregateSpecSchema,
  FILTER_OPERATORS,
  groupBySchema,
} from "../form-engine/records/record-specs.js"

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
  /* 🔴 2026-08-04|**分組與小計原本不在這裡,而前端一直在送** ——
     zod 非 strict,未知鍵直接 strip:使用者設好分組按「另存」,存進去是空的,
     重載回來什麼都沒有,而且**沒有任何錯誤**。每次進頁都要重設,共通檢視也帶不動。

     本模組 §2 現況走查逐字寫著「`view_def.config` 加 `group` / `kanban` / `calendar`
     子物件(加法,零 migration)」—— **已裁定,沒做到**(audit-D §2.1)。

     ⚠️ 直接複用 `record-specs` 的 `groupBySchema` / `aggregateSpecSchema`,
     不另立一份:這兩個東西最後都要餵給同一支查詢 API,分成兩份遲早不一致 ——
     而「前後端兩份鏡射」正是這個 bug 的成因。 */
  groupBy: z.array(groupBySchema).max(3).default([]),
  aggregates: z.array(aggregateSpecSchema).max(10).default([]),
  search: z.string().max(200).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  /* 🔴 v1.1|凍結欄數(`grid-paste.md` §8)。Ragic 官方 `doc/107` 逐字:
     「設定您凍結**欄或列的數量**(欄是從左邊算起)……**列表頁只能設定凍結欄**」
     —— 語意是**數量**不是「選哪幾欄」,與 Glide 的 `freezeColumns: number` 同構。

     ⚠️ **存在檢視而不是表單**:欄位的選取與順序已經是逐檢視的(`fields`),
     所以「從左邊數 2 欄」在不同檢視就是不同的欄。

     🔴 **這一行本身就是重點**:`viewConfigSchema` 是 non-strict zod,未知鍵**靜默 strip**
     —— `groupBy` 就是這樣「前端一直在送、存進去是空的、而且沒有任何錯誤」(見上方註解)。
     只改前端等於什麼都沒改。上限 5:凍太多欄等於把畫面佔滿,而那時使用者只會覺得「壞了」。 */
  freezeColumns: z.number().int().min(0).max(5).default(0),
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
