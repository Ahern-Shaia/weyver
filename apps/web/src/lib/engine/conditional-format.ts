import type { ChipTone } from "@weyver/ui/status-chip"
import { isChipTone } from "@weyver/ui/status-chip"
import type { FormatRule } from "./schemas"

type RecordValues = Record<string, unknown>

/* R1·UP-3b 條件式格式求值(OQ-CF-6=A:純前端;記錄值已在手,零新端點)。

   **純函式、無 I/O** → 可完整單元測。運算子語意必須與後端 filter 一致(FMEA G3):
   同一組 FILTER_OPERATORS,同樣的空值/字串比較規則。

   **覆蓋序(OQ-CF-3=A,Ragic 語意)**:由上而下逐條套用,**後符合者覆蓋前者**。
   UI 需明示「排越後面越優先」—— 這是採此序的必要配套(FMEA G5)。

   **欄位缺失容錯(FMEA G4)**:條件或目標引用已刪除/改名的欄位 → 略過該條規則,
   不讓一條壞規則毀掉整張表的呈現。 */

function asText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) return value.map((v) => String(v)).join(",")
  return String(value)
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true
  return Array.isArray(value) && value.length === 0
}

/* 有序比較:兩邊皆可為數值時走數值,否則字串比較(與後端 SQL 之型別行為對齊:
   數值欄比數值、日期/文字欄比字典序 —— 日期為 ISO 字串故字典序即時序)。 */
function compare(left: unknown, right: unknown): number | null {
  const ln = asNumber(left)
  const rn = asNumber(right)
  if (ln !== null && rn !== null) return ln === rn ? 0 : ln < rn ? -1 : 1
  const ls = asText(left)
  const rs = asText(right)
  if (ls === "" || rs === "") return null
  return ls === rs ? 0 : ls < rs ? -1 : 1
}

export function matchesCondition(value: unknown, op: string, target: unknown): boolean {
  switch (op) {
    case "isEmpty":
      return isEmpty(value)
    case "isNotEmpty":
      return !isEmpty(value)
    case "eq":
      return asText(value) === asText(target)
    case "neq":
      return asText(value) !== asText(target)
    case "contains":
      return asText(value).includes(asText(target))
    case "anyOf": {
      const list = Array.isArray(target) ? target.map(asText) : [asText(target)]
      if (Array.isArray(value)) return value.some((v) => list.includes(asText(v)))
      return list.includes(asText(value))
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const c = compare(value, target)
      if (c === null) return false
      if (op === "gt") return c > 0
      if (op === "gte") return c >= 0
      if (op === "lt") return c < 0
      return c <= 0
    }
    default:
      return false
  }
}

function ruleMatches(rule: FormatRule, values: RecordValues, known: ReadonlySet<string>): boolean {
  // 引用不存在欄位之條件 → 整條規則略過(不靜默誤判為 true)
  if (rule.conditions.some((c) => !known.has(c.field))) return false
  const results = rule.conditions.map((c) => matchesCondition(values[c.field], c.op, c.value))
  return rule.combinator === "or" ? results.some(Boolean) : results.every(Boolean)
}

/* 回傳「欄位顯示名 → tone」。targets 為空 = 套用到該規則條件所涉之欄位。

   🔴 OQ-CF-8 = C-1:規則已升為判別式 `effects[]`,但本函式**仍只回 tone** ——
   目前 `effects` 只有 `color` 一種。等 C-2(hide / readonly / section / message)
   落地時,回傳型別改為 `Map<欄位名, EffectState>`,呼叫端一併改。
   **現在不預先做那個泛化**:沒有第二種效果時,`EffectState` 只會是包了一層的 tone。 */
export function evaluateFormats(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
): Map<string, ChipTone> {
  const known = new Set(fieldNames)
  const out = new Map<string, ChipTone>()
  for (const rule of rules) {
    if (rule.enabled === false) continue
    /* 一條規則可帶多個效果;取最後一個 color(同規則內後者覆蓋,與跨規則同語意) */
    /* 🔴 防禦性:`effects` 型別上必存,但本函式是**渲染前最後一道** ——
       舊形狀的資料、手改的 JSONB、未來的 schema 漂移都可能讓它不見。
       型別不是執行期保證,而 FMEA G1 測的正是「壞資料闖到這裡」。 */
    const effects = Array.isArray(rule.effects) ? rule.effects : []
    const tone = effects.reduce<ChipTone | null>(
      (acc, e) => (e.kind === "color" && isChipTone(e.tone) ? e.tone : acc),
      null,
    )
    if (tone === null) continue // 白名單兜底(後端已 enum 收斂,此為第二道)
    if (!ruleMatches(rule, values, known)) continue
    const targets = rule.targets.length > 0 ? rule.targets : rule.conditions.map((c) => c.field)
    for (const name of targets) {
      if (!known.has(name)) continue // 目標欄已刪 → 略過該欄,其餘照套
      out.set(name, tone) // 後者覆蓋(Ragic 語意)
    }
  }
  return out
}
