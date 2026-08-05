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
  /* 一般欄位名,或**虛擬欄位**(見 `PSEUDO_FIELDS`)。 */
  readonly field: string
  readonly op: string
  readonly value?: unknown
}

/* 🔴 R1·UP-3b v1.4|條件側的虛擬欄位。

   Ragic 官方 `doc/6` 把「條件欄位」分成兩類:記錄上的欄位,以及**不在記錄上**的
   兩件事 —— 逐字:「你也可以針對**當前時間**設定指定日期、時間或區間」、
   「另外也可以針對**登入使用者**設定特定使用者或是群組為指定條件」。

   兩者用**同一個機制**收斂成虛擬欄位,而不是各開一種條件型別:
   條件的形狀不變(field / op / value),只是 `field` 的值從記錄裡取還是從語境取。
   多開一種型別會讓求值器、schema、設計器三處各多一個分支。

   ⚠️ 前綴 `$` 是安全的:欄位名的白名單不允許 `$`(動態 identifier 鎖
   `^[a-z_][a-z0-9_]{0,62}$`),所以撞不到使用者的欄位。 */
export const PSEUDO_FIELDS = {
  /** 求值當下的時間 */
  now: "$now",
  /** 正在看這筆記錄的人 */
  actor: "$actor",
} as const

export function isPseudoField(field: string): boolean {
  return field === PSEUDO_FIELDS.now || field === PSEUDO_FIELDS.actor
}

/* 🔴 求值語境。**兩側都要給**:前端給的是畫面上的人,後端給的是 session 上的人,
   而**說了算的是後端**(C-3 的必填是伺服器強制)。

   `now` 可注入是為了測試 —— 讓「每日 09:00-18:00」這種條件測得起來,
   不必等到那個時刻(凍結時鐘,`rule_full_green_check` 的可重現要求)。 */
export interface EvalContext {
  readonly now?: Date
  readonly actorId?: number | null
  /* 這個人所屬的群組 / 角色 id。空陣列 = 不屬於任何群組(不是「未知」)。 */
  readonly actorGroupIds?: readonly number[]
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
