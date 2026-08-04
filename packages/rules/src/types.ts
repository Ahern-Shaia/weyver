/* R1·UP-3b|條件式格式的**共用型別**。

   🔴 為什麼是一個 package 而不是各寫一份:C-3 之後,同一個判斷同時決定
   **畫面上要不要標必填**與**伺服器要不要拒絕存檔**。兩份實作漂移的後果不是
   樣式不一致,而是「畫面說可以存、伺服器說不行」——使用者看不出自己錯在哪。

   本專案已經有一模一樣的先例:`@weyver/formula` 被前後端共用,
   `formula-preview.ts` 的檔頭逐字寫著「與後端 `FormulaService.computeRecord`
   用**同一套 `@weyver/formula` 引擎**」。這裡照辦。

   ⚠️ 型別在此**結構化宣告**,兩側各自的 zod schema(`layout-specs.ts` /
   web `schemas.ts`)推出來的型別在呼叫點做結構比對 —— 任一側漂移即編譯錯。 */

export type RecordValues = Record<string, unknown>

export const FORMAT_TONES = [
  "ok",
  "warn",
  "error",
  "neutral",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "c7",
  "c8",
] as const

export type FormatTone = (typeof FORMAT_TONES)[number]

export interface FormatCondition {
  readonly field: string
  readonly op: string
  readonly value?: unknown
}

export type FormatEffect =
  | { readonly kind: "color"; readonly tone: string }
  | { readonly kind: "hide" }
  | { readonly kind: "readonly" }
  | { readonly kind: "message"; readonly text: string }
  /* 🔴 C-3|**伺服器強制**的效果。前端照樣要標,但真正說了算的是伺服器 ——
     只在前端做的必填是裝飾,繞過即失效。 */
  | { readonly kind: "required" }

export interface FormatRule {
  readonly combinator: "and" | "or"
  readonly conditions: readonly FormatCondition[]
  readonly targets: readonly string[]
  readonly targetSections: readonly string[]
  /* C-3|動作按鈕(以 id 指涉:按鈕會改名,id 不會) */
  readonly targetButtons?: readonly number[]
  /* C-3|「開始簽核」按鈕。它不是使用者建立的按鈕,沒有 id,故為布林 */
  readonly targetApproval?: boolean
  readonly effects: readonly FormatEffect[]
  readonly note?: string | undefined
  readonly enabled?: boolean
}

export interface SectionRange {
  readonly id: string
  readonly fromRow: number
  readonly toRow: number
}
