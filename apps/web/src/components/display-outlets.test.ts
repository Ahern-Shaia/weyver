import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/* 🔴 顯示出口必須帶齊對照表(audit-E §2.1 / §2.2)。

   ## 為什麼補這一支

   `formatFieldValue(field, value, members?, ctx?, linkLabels?)` 的後三個參數是**可選的**,
   而它們各自負責一種「id → 人看得懂的東西」的翻譯:
   · `members` —— 成員欄的 actor id → 姓名
   · `ctx` —— 租戶時區與語系(日期、金額)
   · `linkLabels` —— 連結欄的目標記錄 id → 標題

   漏傳任何一個都**不會有型別錯誤、不會有執行期錯誤**,只會在那個畫面上印出裸 id
   或錯的時區。2026-08-04 補連結欄可讀顯示時,8 個出口只接了 5 個 ——
   而新加的 e2e 自述「兩者走同一支函式故覆蓋等同覆蓋」,那句話不成立:
   **同一支但參數不同**。

   `displayValue` 則是更底層的那一支,它**不認識** member / link / 附件 ——
   任何拿它來顯示「整筆記錄的任意欄位」的地方都會印錯,而記錄頁的明細表格
   就是這樣印了兩個月的 `[object Object]`。

   ## 這條檢查在擋什麼

   1. 產品碼呼叫 `formatFieldValue` 時,**必須帶滿五個參數**
   2. 產品碼**不得**用 `displayValue` 去渲染 `record.values[...]` 這種任意欄位值
      (只給明確的數值 / 金額欄用,那些型別沒有 id 翻譯問題)

   規則沒有檢查就會漏 —— 這是 `pitfall_rule_without_check_always_drifts` 的第八次。 */

const SRC = join(process.cwd(), "src")

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/* 這兩支自己就是實作,不受規則約束 */
const IMPLEMENTATION = ["components/form/value.ts", "lib/engine/display-value.ts"]

const files = walk(SRC)
  .map((f) => ({ path: relative(SRC, f), text: readFileSync(f, "utf8") }))
  .filter((f) => !IMPLEMENTATION.includes(f.path.replace(/\\/g, "/")))

describe("顯示出口", () => {
  it("🔴 `formatFieldValue` 一律帶滿 members / ctx / linkLabels", () => {
    const offenders: string[] = []
    for (const f of files) {
      /* 逐個呼叫抓到對應的右括號 —— 跨行呼叫很常見,不能只看單行 */
      for (const m of f.text.matchAll(/formatFieldValue\(/g)) {
        const start = m.index + m[0].length
        let depth = 1
        let i = start
        while (i < f.text.length && depth > 0) {
          if (f.text[i] === "(") depth += 1
          else if (f.text[i] === ")") depth -= 1
          i += 1
        }
        const call = f.text.slice(start, i - 1)
        /* 只數最外層逗號 */
        let level = 0
        let args = 1
        for (const ch of call) {
          if ("([{".includes(ch)) level += 1
          else if (")]}".includes(ch)) level -= 1
          else if (ch === "," && level === 0) args += 1
        }
        if (args < 5) offenders.push(`${f.path}(${String(args)} 個參數)`)
      }
    }
    expect(offenders, "漏帶對照表 → 該畫面印出裸 id 或錯的時區").toEqual([])
  })

  it("🔴 不得用 `displayValue` 渲染任意欄位值(它不認識 member / link / 附件)", () => {
    const offenders: string[] = []
    for (const f of files) {
      for (const m of f.text.matchAll(/displayValue\([^)]*\)/g)) {
        /* `values[...]` / `.values.` 這種「整筆記錄的任意欄位」才是問題;
           明確的數值 / 金額欄(如 `totals.get(...)`)沒有 id 翻譯問題 */
        if (/\bvalues[.[]/.test(m[0])) offenders.push(`${f.path}: ${m[0].slice(0, 60)}`)
      }
    }
    expect(offenders, "改用 formatFieldValue —— 它會處理 member / link / 附件").toEqual([])
  })
})
