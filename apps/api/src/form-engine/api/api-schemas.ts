import { z } from "zod"
import type { FieldAccessPolicy } from "../../authz/authz-effective.js"
import { CELL_VALUE_TYPES } from "../field-types/field-type-registry.js"
import type { FieldDefRow, FormWithFields } from "../metadata/metadata.service.js"
import { aggregateSpecSchema } from "../records/record-specs.js"
import { listQuerySchema } from "../records/record-specs.js"

export const createRecordBodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
})

export const updateRecordBodySchema = z.object({
  expectedVersion: z.number().int().min(1),
  values: z.record(z.string(), z.unknown()),
})

export const alterFieldTypeBodySchema = z.object({
  type: z.enum(CELL_VALUE_TYPES),
  options: z.record(z.string(), z.unknown()).default({}),
})

export const moveFieldBodySchema = z.object({
  direction: z.enum(["up", "down"]),
})

/* 型別轉換(#105 四態)。cast 選項:日期格式必須明確、幣別不可推斷。 */
export const convertFieldTypeBodySchema = z.object({
  type: z.enum(CELL_VALUE_TYPES),
  dateFormat: z.enum(["YYYY-MM-DD", "YYYY/MM/DD", "DD/MM/YYYY", "MM/DD/YYYY"]).optional(),
  currency: z.string().max(8).optional(),
  ratingMax: z.number().int().min(1).max(10).optional(),
  choices: z.array(z.string().max(100)).max(200).optional(),
})

/* 🔴 R1·FMT M2|**顯示格式**。與選項端點分開,理由同上一段的精神:
   選項會改寫既有記錄的資料,顯示格式**一個位元組都不動** ——
   合在一起會讓呼叫端分不清自己在做哪件事,也會讓「改格式」背上「可能改資料」的風險感。

   白名單與前端 `DATE_FORMATS` 同一組。民國年(P1)屆時加 key。 */
export const updateDisplayBodySchema = z.object({
  dateFormat: z.enum(["local", "iso", "slash", "dash", "dot"]),
})

/* 選項增刪改名(#105)。刻意與 /type 分開:改型別是 DDL,改選項會改寫**資料**,
   兩者的風險與流程不同,合在一個端點會讓呼叫端分不清自己在做哪件事。 */
export const updateOptionsBodySchema = z.object({
  choices: z
    .array(
      z.object({
        // 既有選項必須帶回原 id,才會被辨識為「改名」而非「刪一個再建一個」
        id: z.string().regex(/^o[0-9a-z]{8}$/),
        name: z.string().trim().min(1).max(100),
        color: z.string().max(20).optional(),
        retired: z.boolean().optional(),
        parents: z.array(z.string()).max(200).optional(),
      }),
    )
    .min(1)
    .max(200),
  // 預設 retire:仍被使用的選項不硬刪,既有值保留(見 option.service 檔頭)
  deleteMode: z.enum(["retire", "replace", "clear"]).default("retire"),
  replaceWith: z.string().max(100).optional(),
})

export const bulkRecordsBodySchema = z.object({
  rows: z.array(z.object({ values: z.record(z.string(), z.unknown()) })).max(5000),
})

/* 🔴 grid-paste M1|批次**更新**(貼上到既有列)。500 列上限為 OQ-GP-2 裁定,
   出處 Smartsheet 官方「You can paste up to 500 rows at a time」。
   超過在此就被 zod 擋下並回 400,**不進到服務層才發現**。 */
export const bulkUpdateRecordsBodySchema = z.object({
  rows: z
    .array(
      z.object({
        recordId: z.number().int().positive(),
        values: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(500),
})

export const saveWithLinesBodySchema = z.object({
  childFormId: z.number().int().positive(),
  header: z.object({
    id: z.number().int().positive().optional(),
    expectedVersion: z.number().int().min(1).optional(),
    values: z.record(z.string(), z.unknown()),
  }),
  lines: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        values: z.record(z.string(), z.unknown()),
      }),
    )
    .max(200),
})

export const listRecordsQuerySchema = listQuerySchema

/* response DTO:不回 tenantId / physicalTable / physicalColumn(內部實作面,禁洩 — AGENTS DTO 鐵則) */
export interface FieldDto {
  readonly id: number
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly unique: boolean
  readonly options: Record<string, unknown>
  readonly position: number
}

export interface FormDto {
  readonly id: number
  readonly name: string
  readonly provisionState: string
  readonly version: number
  readonly parentFormId: number | null
  readonly fields: readonly FieldDto[]
}

export function toFieldDto(row: FieldDefRow): FieldDto {
  return {
    id: row.id,
    name: row.name,
    type: row.cellValueType,
    required: row.required,
    unique: row.isUnique,
    options: row.options as Record<string, unknown>,
    position: row.position,
  }
}

/* 🔴 OQ-PC-11 = A 之「設計期擋」那一半(`pivot-and-charts` §14.5b)。

   在此之前 form DTO **回傳全部欄位,不過欄位級權限** —— 值有 `maskRead` 擋著不會外洩,
   但**欄位名稱會**。而欄位名稱本身就是業務資訊(「離職原因」「毛利率」「客訴等級」
   光是存在就說明了一件事)。

   受影響的不只圖表軸:設計器、篩選面板、看板分欄、匯出欄位選單 —— 凡是列欄位的地方
   都在列使用者無權看的欄位。而**執行期是 fail-closed 的**,所以使用者選得到一個
   必定失敗的軸 —— 那正是 OQ-PC-11 引 Salesforce 時要避免的形態
   (「讓使用者建得出一張永遠壞掉的圖」)。

   `policy` 未帶時不過濾,維持既有呼叫端行為(dev 路徑與內部呼叫)。 */
export function toFormDto(loaded: FormWithFields, policy?: FieldAccessPolicy): FormDto {
  const fields =
    policy === undefined
      ? loaded.fields
      : loaded.fields.filter((f) => policy.fieldVisibility(f.id, loaded.form.id) !== "hidden")
  return {
    id: loaded.form.id,
    name: loaded.form.name,
    provisionState: loaded.form.provisionState,
    version: loaded.form.version,
    parentFormId: loaded.form.parentFormId,
    fields: fields.map(toFieldDto),
  }
}

/* F-1 分組統計請求。query 與列表同一個 schema —— 母體必須一致,否則小計與列表對不上。 */
export const groupStatsBodySchema = z.object({
  query: z.unknown(),
  aggregates: z.array(aggregateSpecSchema).max(10).default([]),
})
