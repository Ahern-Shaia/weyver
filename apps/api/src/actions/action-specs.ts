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
/* 🔴 OQ-AP2-1|簽核人怎麼決定。`role` 為既有行為(靜態角色),其餘三種是執行期解析。

   三種動態解析對齊 Ragic 官方(逐字):「選擇**直屬主管**的話,系統就會送簽給發起簽核
   的使用者的直屬主管;選擇**直屬主管的主管**…;選擇**前一簽核人的主管**…」——
   這是 parity 基準線不是進階功能:沒有它,行政人員得為每個部門各建一組 role + 一份
   approval_def,維護不了。

   「主管」由 role tree 推導(見 `ActionsRepository.managersOf`),不引入第二份組織關係。 */
export const APPROVER_RULES = [
  "role",
  "manager",
  "managerOfManager",
  "managerOfPrevApprover",
] as const
export type ApproverRule = (typeof APPROVER_RULES)[number]

export const approvalStepSchema = z
  .object({
    stepNo: z.number().int().min(1).max(20),
    /* 動態規則下沒有靜態角色可指定,故為選配 */
    approverRoleId: z.number().int().positive().optional(),
    approverRule: z.enum(APPROVER_RULES).default("role"),
    /* 🔴 OQ-AP2-3|會簽 / 擇辦。**null(或未填)= 全體同意**。
       採 Ragic 的退化式設計(官方逐字:「若將擇辦人數清空,則等同於會簽(All)」)——
       All 是 N 的退化值,不是獨立模式。用 `mode` enum + 數字的話,
       `mode:'all'` 卻帶 `quorum:2` 要信哪個永遠是個問題;這個形狀結構上不可能矛盾。 */
    quorum: z.number().int().positive().nullable().optional(),
    /* 🔴 OQ-AP2-6|可退回的關卡白名單;未填 = 所有先前關卡(Kissflow 形態) */
    returnableTo: z.array(z.number().int().min(1).max(20)).optional(),
    /* 條件:本記錄之 amountField 值 >= minAmount 時此步才啟用(缺省=恆啟用) */
    amountField: z.string().max(100).optional(),
    minAmount: z.number().optional(),
  })
  .refine((s) => s.approverRule !== "role" || s.approverRoleId !== undefined, {
    message: "靜態角色簽核必須指定 approverRoleId",
    path: ["approverRoleId"],
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
