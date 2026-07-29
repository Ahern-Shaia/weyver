import { z } from "zod"

export const FILTER_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "anyOf",
  "isEmpty",
  "isNotEmpty",
] as const

/* 🔴 F-1 分組(OQ-VG-3=A:3 層上限)。
   **分組不是聚合查詢,是排序的變形** —— group key 前置進 ORDER BY,keyset 完整保留。
   AG Grid 明載 infinite row model 不支援 grouping,前提是把分組理解成「先聚合再展開」;
   改成排序變形即無此限制(等同其 paginateChildRows 語意)。docs/modules/R1/views-group-kanban-calendar.md §4.1 */
export const GROUP_DATE_UNITS = ["day", "month", "quarter", "year"] as const
export type GroupDateUnit = (typeof GROUP_DATE_UNITS)[number]

export const groupBySchema = z.object({
  field: z.string().min(1).max(100),
  dir: z.enum(["asc", "desc"]).default("asc"),
  /* 日期欄的分組粒度(Ragic 原生有;Airtable 需繞公式欄)。非日期欄忽略。 */
  unit: z.enum(GROUP_DATE_UNITS).optional(),
})
export type GroupBy = z.infer<typeof groupBySchema>

export const GROUP_AGGREGATE_FNS = ["count", "empty", "filled", "sum", "avg", "min", "max"] as const
export type GroupAggregateFn = (typeof GROUP_AGGREGATE_FNS)[number]

export const aggregateSpecSchema = z.object({
  field: z.string().min(1).max(100),
  fn: z.enum(GROUP_AGGREGATE_FNS),
})

export const listQuerySchema = z.object({
  filters: z
    .array(
      z.object({
        field: z.string().min(1).max(100),
        op: z.enum(FILTER_OPERATORS),
        value: z.unknown().optional(),
      }),
    )
    .max(20)
    .default([]),
  // R1·UP-2 單層 combinator(OQ-VL-1):跨 filters 之 AND|OR;缺省 = and(向後相容既有呼叫)
  combinator: z.enum(["and", "or"]).optional(),
  // R1·UP-2 快速搜尋:對 textual 欄 ILIKE OR 串接(record.service 白名單解析物理欄)
  q: z.string().max(200).optional(),
  /* F-1:分組鍵前置於 sort 之前(≤3 層)。cursor 一併涵蓋,故續頁不會跨組錯位。
     **optional 而非 default([])** —— 既有內部呼叫端(匯入 / 反向關聯 / 子表)不必改。 */
  groupBy: z.array(groupBySchema).max(3).optional(),
  /* 折疊的群組鍵值組合。**必須傳到後端** —— 否則折疊只是前端隱藏卻照吃 page size,
     使用者會看到「明明折疊了卻出現空白頁」(承 Teable collapsedGroupIds 語意)。 */
  collapsed: z.array(z.array(z.string())).max(200).optional(),
  sort: z
    .array(
      z.object({
        field: z.string().min(1).max(100),
        dir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .max(5)
    .default([]),
  /* 🔴 不透明續頁權杖(#95)。原本是 record id,但排序鍵非 id 時
     `WHERE id > cursor` 與 `ORDER BY sortCol, id` 對不起來,整頁會被跳過。
     權杖需帶上「最後一列的各排序值 + id」才能正確續頁,故不再是單一數字。 */
  cursor: z.string().max(4000).optional(),
  limit: z.number().int().min(1).max(200).default(50),
})

export type ListQuery = z.infer<typeof listQuerySchema>

/* 記錄值:以欄位「顯示名」為 key(Ragic 範式;name 對 live 欄位唯一) */
export type RecordValues = Record<string, unknown>

export interface RecordRow {
  readonly id: number
  readonly version: number
  readonly createdAt: Date
  readonly createdBy: number
  readonly updatedAt: Date
  readonly updatedBy: number
  readonly parentId: number | null
  readonly lineNo: number | null
  readonly values: RecordValues
}

export interface LineInput {
  readonly id?: number | undefined
  readonly values: RecordValues
}
