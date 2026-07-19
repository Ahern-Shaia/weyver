import { z } from "zod"
import {
  CELL_VALUE_TYPES,
  FIELD_TYPE_REGISTRY,
  type CellValueType,
} from "../field-types/field-type-registry.js"

/* AI-native 不變量(docs/17 / docs/22):結構化 spec 是建表唯一入口 —
   設計器 UI 與 AI 建表助手皆吐同一 spec,經同一驗證 + DDL 安全鏈。 */

const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 刻意排除控制字元的安全驗證
  .regex(/^[^\u0000-\u001F\u007F]*$/u, "control characters not allowed")

export const addFieldSpecSchema = z
  .object({
    name: displayNameSchema,
    type: z.enum(CELL_VALUE_TYPES),
    required: z.boolean().default(false),
    unique: z.boolean().default(false),
    options: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    const result = FIELD_TYPE_REGISTRY[value.type].optionsSchema.safeParse(value.options)
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `invalid options for type ${value.type}: ${result.error.message}`,
      })
    }
  })

export type AddFieldSpec = z.infer<typeof addFieldSpecSchema>

export const createFormSpecSchema = z
  .object({
    name: displayNameSchema,
    parentFormId: z.number().int().positive().optional(),
    fields: z.array(addFieldSpecSchema).min(1).max(300),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    for (const [index, field] of value.fields.entries()) {
      if (seen.has(field.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", index, "name"],
          message: `duplicate field name: ${field.name}`,
        })
      }
      seen.add(field.name)
    }
  })

export type CreateFormSpec = z.infer<typeof createFormSpecSchema>

export function normalizedOptions(
  type: CellValueType,
  options: Record<string, unknown>,
): Record<string, unknown> {
  return FIELD_TYPE_REGISTRY[type].optionsSchema.parse(options) as Record<string, unknown>
}
