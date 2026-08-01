import { z } from "zod"

/* 匯入既有表單的契約(#106,深研見 docs/modules/R1/import-to-existing-form.md §0)。 */

/* 四政策,對齊 Ragic 客戶既有心智(產生新資料 / 更新舊資料 / 只更新不新增)+ 補一個。 */
export const IMPORT_POLICIES = ["insert_only", "upsert", "update_only", "insert_new_only"] as const
export type ImportPolicy = (typeof IMPORT_POLICIES)[number]

export const importPlanSchema = z.object({
  policy: z.enum(IMPORT_POLICIES),
  /* 比對鍵。1–3 欄複合鍵(對齊 Airtable API 上限)。insert_only 不需要。 */
  matchFields: z.array(z.string().min(1).max(100)).max(3).default([]),
  /* 正規化(OQ-IMP-7)。trim 與大小寫對齊 Airtable;
   **NFKC 全形→半形業界全無**,但台灣客戶的舊 Excel 混用全半形是常態。 */
  caseSensitive: z.boolean().default(false),
  trim: z.boolean().default(true),
  normalize: z.enum(["none", "nfkc"]).default("nfkc"),
  /* 欄名 → 表單欄位名。未列入者一律不動(業界一致:未映射欄位保留)。 */
  mapping: z.record(z.string(), z.string()),
  /* 🔴 OQ-IMP-2:預設 keep。Shopify 無開關直接清空是真實事故來源。 */
  blankPolicy: z.enum(["keep", "clear"]).default("keep"),
  /* 檔內 key 重複:PG 的 ON CONFLICT 遇到會直接爆(cardinality violation),
     不能丟給 DB。預設 reject —— Airtable 的「只用第一列且靜默忽略」是壞示範。 */
  duplicateInFile: z.enum(["reject", "first_wins", "last_wins"]).default("reject"),
  unknownSelectOption: z.enum(["error", "create"]).default("error"),
  errorPolicy: z.enum(["abort", "skip"]).default("abort"),
  /* OQ-IMP-8:業界無一家做。值沒變就不寫 → 不污染 updated_at / 稽核 / 通知。 */
  noopDetection: z.boolean().default(true),
  rows: z.array(z.record(z.string(), z.string())).max(50_000),
})

export type ImportPlanInput = z.infer<typeof importPlanSchema>

export const commitImportSchema = z.object({
  planHash: z.string().min(1),
  plan: importPlanSchema,
  /* 🔴 OQ-IMP-2:blankPolicy=clear 會清空既有值(Shopify N1 事故的形狀),
     裁定為「開放但需打字確認表單名稱」。**後端也驗** —— 只放前端的確認對話框
     等於沒有,API 直接呼叫就繞過了。 */
  confirmFormName: z.string().optional(),
})

export interface RowPlan {
  readonly sourceRowNo: number
  readonly op: "insert" | "update" | "noop" | "skip" | "error"
  readonly recordId?: number
  readonly matchKey?: string
  readonly values?: Record<string, unknown>
  readonly before?: Record<string, unknown>
  readonly errorCode?: string
  readonly errorMessage?: string
}

export interface ImportBlocker {
  readonly code: string
  readonly message: string
}

export interface ImportWarning {
  readonly code: string
  readonly message: string
  readonly rows: readonly number[]
  readonly sample?: readonly (readonly [string, string])[]
}

export interface ImportPlanResult {
  readonly planHash: string
  readonly totals: {
    readonly rows: number
    readonly toInsert: number
    readonly toUpdate: number
    readonly unchanged: number
    readonly errors: number
    readonly skipped: number
  }
  readonly impact: {
    readonly fieldsToClear: number
    readonly recordsAffected: number
    /* §4.2「更新影響 >20% 或 >1000 筆 → 警 + 二次確認」。
       比例需要知道表上總筆數,故一併回傳,讓 UI 能講出「500 筆中的 480 筆」。 */
    readonly existingTotal: number
    readonly needsConfirm: boolean
  }
  /* 非空 → commit 一律 409。這是「擋」與「警」的分界。 */
  readonly blockers: readonly ImportBlocker[]
  readonly warnings: readonly ImportWarning[]
  readonly rowErrors: readonly RowPlan[]
}
