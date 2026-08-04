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

/* 🔴 分段 → 欄位的展開表(OQ-CF-9)。

   成員關係由 `fromRow`/`toRow` 的**列區間**推導 —— 那是設計器實際在寫的東西。
   ⚠️ `fieldLayoutSchema` 曾有一個 `sectionId` 欄位,**零 reader 零 writer**,
   本批已移除:留著就會變成第二套成員關係,而兩套遲早不一致
   (同 `a66f110` 移掉 `colWidths` / `rowHeights` 的理由)。 */
export function sectionMembers(
  sections: readonly { readonly id: string; readonly fromRow: number; readonly toRow: number }[],
  fieldRows: ReadonlyMap<string, number>,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const sec of sections) {
    const lo = Math.min(sec.fromRow, sec.toRow)
    const hi = Math.max(sec.fromRow, sec.toRow)
    const names: string[] = []
    for (const [name, row] of fieldRows) if (row >= lo && row <= hi) names.push(name)
    out.set(sec.id, names)
  }
  return out
}

export function evaluateFieldStates(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
  members?: ReadonlyMap<string, readonly string[]>,
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

    /* 分段是**目標選擇器**不是效果 —— 展開後與 `targets` 併集,
       於是仲裁空間仍然只有一個(每個欄位),後者覆蓋跨兩者自動一致。 */
    const fromSections = (rule.targetSections ?? []).flatMap((id) => members?.get(id) ?? [])
    const explicit = [...rule.targets, ...fromSections]
    const targets = explicit.length > 0 ? explicit : rule.conditions.map((c) => c.field)
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

/* 🔴 C-2 後半|顯示訊息(OQ-CF-11)。

   ## 插值不得成為遮罩的旁路

   求值在前端,而前端拿到的 `values` **已經過 `maskRead`** ——
   對此人隱藏的欄位根本不在裡面。此時**不得留空**:留空會讓人以為那一欄沒有資料,
   而他其實是沒有權限。回具名的「(無權檢視)」,沿用 `link-options` 回 `#id`
   與 `pivot-and-charts` 的同一裁定 —— **寧可具名,不要靜默。**

   ⚠️ 2026-08-04 才修過公式的同型洩漏(以隱藏欄算出來的公式值沒有一起遮)。
   插值是**同一個形狀的第二個出口**,所以這裡從一開始就走可見值。

   ⚠️ 條件式**隱藏**的欄位不在此列 —— 那只是版面層,官方逐字說明
   「只會作用於排版介面上,於修改資料紀錄或通知信中仍會顯示該欄位的資料」。

   ## 為什麼只切第一個冒號

   Ragic 的參數是 `{{fieldValue_欄位編號}}`,底線後面是數字所以沒有歧義。
   我方用**欄名**(與 `conditions.field` / `targets` 同一種指涉,不讓使用者學兩套),
   而欄名可以含底線也可以含冒號 —— 故前綴為固定關鍵字,只切**第一個**分隔符。 */
const MASKED = "(無權檢視)"

export function renderMessage(
  text: string,
  values: RecordValues,
  known: ReadonlySet<string>,
): string {
  return text.replace(/\{\{([^{}]{1,200})\}\}/g, (whole, inner: string) => {
    const at = inner.indexOf(":")
    if (at < 0) return whole
    const kind = inner.slice(0, at).trim()
    const name = inner.slice(at + 1).trim()
    if (kind !== "fieldValue" && kind !== "fieldName") return whole
    /* 欄位不存在(已刪 / 打錯)→ 原樣留著。**不要換成空字串** ——
       設計者看到自己打的參數還在,才知道是名字寫錯了。 */
    if (!known.has(name)) return whole
    if (kind === "fieldName") return name
    if (!(name in values)) return MASKED
    const v = values[name]
    return v === null || v === undefined ? "" : String(v)
  })
}

/* 規則層效果 → 依規則順序回傳已插值的訊息。同一條規則可有多則。 */
export function evaluateMessages(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
): string[] {
  const known = new Set(fieldNames)
  const out: string[] = []
  for (const rule of rules) {
    if (rule.enabled === false) continue
    const effects = Array.isArray(rule.effects) ? rule.effects : []
    if (!effects.some((e) => e.kind === "message")) continue
    if (!ruleMatches(rule, values, known)) continue
    for (const e of effects) {
      if (e.kind !== "message") continue
      const text = renderMessage(e.text, values, known).trim()
      if (text !== "") out.push(text)
    }
  }
  return out
}
