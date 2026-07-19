import { z } from "zod"
import { CELL_VALUE_TYPES } from "../field-types/field-type-registry.js"
import { listQuerySchema } from "../records/record-specs.js"
import type { FieldDefRow, FormWithFields } from "../metadata/metadata.service.js"

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

export function toFormDto(loaded: FormWithFields): FormDto {
  return {
    id: loaded.form.id,
    name: loaded.form.name,
    provisionState: loaded.form.provisionState,
    version: loaded.form.version,
    parentFormId: loaded.form.parentFormId,
    fields: loaded.fields.map(toFieldDto),
  }
}
