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

/* 🔴 OQ-CF-8 = C-2:求值器回傳**欄位效果狀態**,不再只回顏色。

   **S1 雙向邏輯(Ragic 官方逐字)**|「當條件成立時執行某動作,也同時代表條件不成立時
   **不執行**該動作」——效果是**三態**:命中 → 套用 / 未命中 → **還原為預設**。
   本函式**每次從零重算**,故未命中天然回到預設(= 靜態欄位屬性),S1 by construction 成立。
   ⚠️ 這一點對顏色恰好等價(未命中即無色),對「隱藏」**不等價** ——
   若改成增量更新就會壞掉,而那正是官方〈問題排除〉整節在解釋的坑。 */
export interface FieldEffectState {
  readonly tone?: ChipTone
  readonly hidden?: boolean
  readonly readonly?: boolean
}

export function evaluateFieldStates(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
): Map<string, FieldEffectState> {
  const known = new Set(fieldNames)
  const out = new Map<string, FieldEffectState>()
  for (const rule of rules) {
    if (rule.enabled === false) continue
    /* 🔴 防禦性:`effects` 型別上必存,但本函式是**渲染前最後一道** ——
       舊形狀的資料、手改的 JSONB、未來的 schema 漂移都可能讓它不見。
       型別不是執行期保證,而 FMEA G1 測的正是「壞資料闖到這裡」。 */
    const effects = Array.isArray(rule.effects) ? rule.effects : []
    if (effects.length === 0) continue
    if (!ruleMatches(rule, values, known)) continue

    /* 同一規則內後者覆蓋,與跨規則同語意 */
    let patch: FieldEffectState = {}
    for (const e of effects) {
      if (e.kind === "color") {
        if (isChipTone(e.tone)) patch = { ...patch, tone: e.tone } // 白名單第二道
      } else if (e.kind === "hide") patch = { ...patch, hidden: true }
      else if (e.kind === "readonly") patch = { ...patch, readonly: true }
    }
    if (Object.keys(patch).length === 0) continue

    const targets = rule.targets.length > 0 ? rule.targets : rule.conditions.map((c) => c.field)
    for (const name of targets) {
      if (!known.has(name)) continue // 目標欄已刪 → 略過該欄,其餘照套
      out.set(name, { ...out.get(name), ...patch }) // 後者覆蓋(Ragic 語意)
    }
  }
  return out
}

/* 顏色專用的既有介面 —— 三個呼叫端只要 tone,不必各自解 state。 */
export function evaluateFormats(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
): Map<string, ChipTone> {
  const out = new Map<string, ChipTone>()
  for (const [name, st] of evaluateFieldStates(rules, values, fieldNames)) {
    if (st.tone !== undefined) out.set(name, st.tone)
  }
  return out
}

/* 🔴 S4 靜態欄位屬性 × 條件式規則的仲裁(Ragic 官方逐字,§0.2 S4)。

   (1)「已將某個欄位設為必填或隱藏時,條件式格式**無法選擇**將該欄位設為
       必填或隱藏/顯示」→ 靜態 hidden 為終局,規則不得把它顯示回來。
   (3)「欄位設為**唯讀**的情況,**條件式格式必會優先於**欄位屬性設定」
       → readonly 由規則說了算。
   末段「當欄位因條件式格式被**隱藏**時,系統會**略過檢查必填及輸入檢查**」
       → 由 `skipValidation` 表達;隱藏的欄位要求必填會讓使用者卡死在看不見的欄位上。 */
export function resolveFieldAttrs(
  staticAttrs: { readonly hidden?: boolean | undefined; readonly readonly?: boolean | undefined },
  effect: FieldEffectState | undefined,
): { hidden: boolean; readonly: boolean; skipValidation: boolean } {
  const hiddenByRule = effect?.hidden === true
  const hidden = staticAttrs.hidden === true || hiddenByRule
  return {
    hidden,
    /* 規則有講就聽規則(S4-3);沒講才回到靜態值 —— 這是「條件式優先」的實作 */
    readonly: effect?.readonly ?? staticAttrs.readonly === true,
    skipValidation: hiddenByRule,
  }
}
