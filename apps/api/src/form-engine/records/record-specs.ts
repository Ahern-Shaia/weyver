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
  sort: z
    .array(
      z.object({
        field: z.string().min(1).max(100),
        dir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .max(5)
    .default([]),
  cursor: z.number().int().positive().optional(),
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
  readonly id?: number
  readonly values: RecordValues
}
