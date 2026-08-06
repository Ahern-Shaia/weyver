import { z } from "zod"

/* R1·AI-1 M1|AI 設定與 provider 契約。 */

export const AI_PROVIDERS = ["anthropic", "openai", "google"] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

/* 🔴 模型清單走設定不寫死(OQ-AI-9=B)。

   依據:Ragic `doc/176` 的官方模型表已經是 GPT 5 / Claude 4.6 / Gemini 2.5 ——
   模型半年換一輪,寫死等於每次換模型都要出一版。這裡的預設只是**建議值**,
   租戶可以填任何 model id(下面 `modelSchema` 不對照清單)。 */
export const SUGGESTED_MODELS: Readonly<Record<AiProvider, readonly string[]>> = {
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5.2", "gpt-5-mini", "gpt-5-nano"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
}

/* provider 的 model id 沒有共通格式,只擋長度與明顯垃圾 —— 白名單會擋掉
   明天才發布的模型,而那正是 OQ-AI-9 要避免的。 */
const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9._:-]+$/, "模型代號只能是英數與 . _ : -")

/* 金鑰只在**寫入**時出現一次,之後永遠不回傳。 */
export const aiConfigPatchSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(AI_PROVIDERS),
    model: modelSchema,
    /* 空字串 = 清掉金鑰(與 taxId / 浮水印同一個語意) */
    apiKey: z.string().trim().max(400),
    /* 🔴 資料外送同意。true = 同意(記下當下的人與時間);false = 撤回。
       這不是「勾一次就算了」—— 撤回會讓 enabled 的 CHECK 擋下整筆,
       等於關掉 AI,那是刻意的。 */
    consent: z.boolean(),
  })
  .partial()

export type AiConfigPatch = z.infer<typeof aiConfigPatchSchema>

/* 對外的設定形狀。**沒有 apiKey** —— 只有末四碼。 */
export interface AiConfigDto {
  readonly enabled: boolean
  readonly provider: AiProvider | null
  readonly model: string | null
  readonly apiKeyHint: string | null
  readonly hasApiKey: boolean
  readonly consentAt: string | null
  readonly suggestedModels: Readonly<Record<AiProvider, readonly string[]>>
}

/* 用量摘要。**不是「還剩多少額度」** ——
   BYO key 模式下我方看不到客戶在 provider 那邊的帳單(見 migration 0064)。
   這裡講的是「本平台代你送出了多少」。 */
export interface AiUsageRow {
  readonly provider: string
  readonly model: string
  readonly feature: string
  readonly calls: number
  readonly failedCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
}
