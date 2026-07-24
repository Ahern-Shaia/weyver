import { z } from "zod"

/* R1·後續-1 按鈕動作 + 簽核之邊界 schema。
   動作為**封閉 allowlist**(docs/22 不變量:結構化 intent → 確定性編譯 → 人核准 → audit);
   config 由後端依 action_type 解析執行,絕不 eval。 */

/* 值來源:literal(固定值)/ field(取本記錄某欄)/ variable(執行期變數) */
export const valueSourceSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("literal"), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ from: z.literal("field"), field: z.string().min(1).max(100) }),
  z.object({ from: z.literal("variable"), variable: z.enum(["$NOW", "$TODAY", "$USERID"]) }),
])
export type ValueSource = z.infer<typeof valueSourceSchema>

const httpsUrl = z
  .string()
  .max(2000)
  .refine((u) => /^https:\/\//.test(u) || u.startsWith("/"), "url 僅允 https 或相對路徑")

export const buttonConfigSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("updateSelf"),
    setFields: z.record(z.string().max(100), valueSourceSchema),
  }),
  z.object({
    actionType: z.literal("pushTo"),
    targetFormId: z.number().int().positive(),
    fieldMap: z.record(z.string().max(100), valueSourceSchema),
  }),
  z.object({ actionType: z.literal("openUrl"), url: httpsUrl }),
])
export type ButtonConfig = z.infer<typeof buttonConfigSchema>

export const createButtonBodySchema = z.object({
  label: z.string().min(1).max(60),
  config: buttonConfigSchema,
  confirm: z.boolean().default(true),
})
export type CreateButtonBody = z.infer<typeof createButtonBodySchema>

export const updateButtonBodySchema = z.object({
  label: z.string().min(1).max(60).optional(),
  config: buttonConfigSchema.optional(),
  confirm: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
})
export type UpdateButtonBody = z.infer<typeof updateButtonBodySchema>

export interface ButtonDto {
  readonly id: number
  readonly formId: number
  readonly label: string
  readonly actionType: ButtonConfig["actionType"]
  readonly config: ButtonConfig
  readonly confirm: boolean
  readonly position: number
}

/* 簽核定義:順序多步(OQ-AA-3=A 階層);金額條件由 ZEN 決策(minAmount + amountField)。 */
export const approvalStepSchema = z.object({
  stepNo: z.number().int().min(1).max(20),
  approverRoleId: z.number().int().positive(),
  /* 條件:本記錄之 amountField 值 >= minAmount 時此步才啟用(缺省=恆啟用) */
  amountField: z.string().max(100).optional(),
  minAmount: z.number().optional(),
})
export type ApprovalStep = z.infer<typeof approvalStepSchema>

export const createApprovalDefBodySchema = z.object({
  name: z.string().min(1).max(60),
  steps: z.array(approvalStepSchema).min(1).max(20),
  onCompleteButtonId: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
})
export type CreateApprovalDefBody = z.infer<typeof createApprovalDefBodySchema>

export const decisionBodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().max(1000).optional(),
})

export interface ApprovalDefDto {
  readonly id: number
  readonly formId: number
  readonly name: string
  readonly steps: readonly ApprovalStep[]
  readonly onCompleteButtonId: number | null
  readonly active: boolean
}

export interface ApprovalInstanceDto {
  readonly id: number
  readonly defId: number
  readonly formId: number
  readonly recordId: number
  readonly currentStep: number
  readonly status: "pending" | "approved" | "rejected" | "withdrawn"
  readonly submittedBy: number
  readonly updatedAt: string
  readonly steps: readonly ApprovalStep[]
  readonly log: readonly {
    stepNo: number
    actorId: number
    decision: string
    comment: string | null
    at: string
  }[]
}
