import {
  type EvalContext,
  FORMAT_TONES,
  type FormatCondition,
  type FormatRule,
  type FormatTone,
  type RecordValues,
  PSEUDO_FIELDS,
  type SectionRange,
  isPseudoField,
} from "./types"

/* tone 白名單第二道 —— 第一道在兩側的 zod schema。渲染前最後一關不信型別 */
function isFormatTone(v: unknown): v is FormatTone {
  return typeof v === "string" && (FORMAT_TONES as readonly string[]).includes(v)
}

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
    /* 🔴 Ragic `doc/6` 逐字:「也可以設定為**是否處於指定日期、時間區間**」。
       兩端皆含(closed interval)—— 使用者說「3/1 到 3/5」時心裡想的就是含 3/5。 */
    case "between": {
      const range = Array.isArray(target) ? target : []
      const lo = compare(value, range[0])
      const hi = compare(value, range[1])
      return lo !== null && hi !== null && lo >= 0 && hi <= 0
    }
    /* 🔴 每日指定時間(「還能將**每日指定時間**設為指定條件」)。
       比的是**時分**不是日期 —— 跨午夜的區間(22:00–02:00)也要成立,
       故不是單純的大小比較。 */
    case "dailyBetween": {
      const range = Array.isArray(target) ? target.map(asText) : []
      const at = asText(value)
      const [from, to] = [range[0] ?? "", range[1] ?? ""]
      if (at === "" || from === "" || to === "") return false
      return from <= to ? at >= from && at <= to : at >= from || at <= to
    }
    /* 群組條件。Ragic 逐字:「當條件包含**多個群組**時,可以設定為:
       需屬於／不屬於其中任一群組,或必須屬於／不屬於所有指定群組。」四種都給,
       因為「不屬於任一」與「不屬於全部」在實務上是兩件不同的事。 */
    case "inAnyGroup":
    case "notInAnyGroup":
    case "inAllGroups":
    case "notInAllGroups": {
      const mine = new Set((Array.isArray(value) ? value : []).map(asText))
      const wanted = (Array.isArray(target) ? target : []).map(asText).filter((t) => t !== "")
      if (wanted.length === 0) return false
      const any = wanted.some((g) => mine.has(g))
      const all = wanted.every((g) => mine.has(g))
      if (op === "inAnyGroup") return any
      if (op === "notInAnyGroup") return !any
      if (op === "inAllGroups") return all
      return !all
    }
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

/* 條件要比的那個值:一般欄位取自記錄,虛擬欄位取自語境。

   🔴 `$actor` 對群組運算子回**群組清單**,對其他運算子回 **actor id** ——
   同一個虛擬欄位依運算子給不同形狀,是因為 Ragic 的 UI 也是這樣:
   選了「登入使用者」之後,才決定要比「是哪個人」還是「屬於哪個群組」。 */
function conditionValue(c: FormatCondition, values: RecordValues, ctx: EvalContext): unknown {
  if (c.field === PSEUDO_FIELDS.now) {
    const now = ctx.now ?? new Date()
    /* 每日時間比的是「時:分」,其餘比的是完整時刻(ISO 字串,字典序即時序) */
    return c.op === "dailyBetween" ? now.toISOString().slice(11, 16) : now.toISOString()
  }
  if (c.field === PSEUDO_FIELDS.actor) {
    return c.op.includes("Group")
      ? [...(ctx.actorGroupIds ?? [])]
      : (ctx.actorId ?? null)
  }
  return values[c.field]
}

/* 🔴 條件列表求值。**匯出**是因為事件觸發器(R1·C-4)也要用同一份判斷 ——
   它的條件與條件式格式是同一個形狀,但沒有 `effects` 也沒有 `targets`,
   所以它要的是這一層而不是整條 `FormatRule`。

   ⚠️ 這裡刻意是「把既有邏輯抽出來」而不是「給觸發器寫一份」:
   「引用不存在欄位 → 整條略過」這種**沉默但關鍵**的語意若有兩份實作,
   漂移的形態是「同一個條件在格式上不成立、在觸發器上成立」,沒有人查得出來。 */
export function conditionsMatch(
  conditions: readonly FormatCondition[],
  combinator: "and" | "or",
  values: RecordValues,
  known: ReadonlySet<string>,
  ctx: EvalContext = {},
): boolean {
  /* 引用不存在欄位之條件 → 整條規則略過(不靜默誤判為 true)。
     虛擬欄位不在 `known` 裡,但它們永遠「存在」。 */
  if (conditions.some((c) => !isPseudoField(c.field) && !known.has(c.field))) return false
  const results = conditions.map((c) =>
    matchesCondition(conditionValue(c, values, ctx), c.op, c.value),
  )
  return combinator === "or" ? results.some(Boolean) : results.every(Boolean)
}

function ruleMatches(
  rule: FormatRule,
  values: RecordValues,
  known: ReadonlySet<string>,
  ctx: EvalContext,
): boolean {
  return conditionsMatch(rule.conditions, rule.combinator, values, known, ctx)
}

/* 🔴 OQ-CF-8 = C-2:求值器回傳**欄位效果狀態**,不再只回顏色。

   **S1 雙向邏輯(Ragic 官方逐字)**|「當條件成立時執行某動作,也同時代表條件不成立時
   **不執行**該動作」——效果是**三態**:命中 → 套用 / 未命中 → **還原為預設**。
   本函式**每次從零重算**,故未命中天然回到預設(= 靜態欄位屬性),S1 by construction 成立。
   ⚠️ 這一點對顏色恰好等價(未命中即無色),對「隱藏」**不等價** ——
   若改成增量更新就會壞掉,而那正是官方〈問題排除〉整節在解釋的坑。 */
export interface FieldEffectState {
  readonly tone?: FormatTone
  readonly hidden?: boolean
  readonly readonly?: boolean
  /* 🔴 C-3|條件式必填。**伺服器也吃這個函式**,故此處是唯一真相 */
  readonly required?: boolean
}

/* 🔴 分段 → 欄位的展開表(OQ-CF-9)。

   成員關係由 `fromRow`/`toRow` 的**列區間**推導 —— 那是設計器實際在寫的東西。
   ⚠️ `fieldLayoutSchema` 曾有一個 `sectionId` 欄位,**零 reader 零 writer**,
   本批已移除:留著就會變成第二套成員關係,而兩套遲早不一致
   (同 `a66f110` 移掉 `colWidths` / `rowHeights` 的理由)。 */
export function sectionMembers(
  sections: readonly SectionRange[],
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
  /* 🔴 選填且**尾綴**:既有呼叫端一行不動,而給了就吃得到虛擬欄位。
     沒給時 `$now` 用當下時間、`$actor` 為 null(= 沒有登入者 → 使用者條件不成立)。 */
  ctx: EvalContext = {},
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
    if (!ruleMatches(rule, values, known, ctx)) continue

    /* 同一規則內後者覆蓋,與跨規則同語意 */
    let patch: FieldEffectState = {}
    for (const e of effects) {
      if (e.kind === "color") {
        if (isFormatTone(e.tone)) patch = { ...patch, tone: e.tone } // 白名單第二道
      } else if (e.kind === "hide") patch = { ...patch, hidden: true }
      else if (e.kind === "readonly") patch = { ...patch, readonly: true }
      else if (e.kind === "required") patch = { ...patch, required: true }
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
  ctx: EvalContext = {},
): Map<string, FormatTone> {
  const out = new Map<string, FormatTone>()
  for (const [name, st] of evaluateFieldStates(rules, values, fieldNames, undefined, ctx)) {
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
  staticAttrs: {
    readonly hidden?: boolean | undefined
    readonly readonly?: boolean | undefined
    readonly required?: boolean | undefined
  },
  effect: FieldEffectState | undefined,
): { hidden: boolean; readonly: boolean; required: boolean; skipValidation: boolean } {
  const hiddenByRule = effect?.hidden === true
  const hidden = staticAttrs.hidden === true || hiddenByRule
  return {
    hidden,
    /* 規則有講就聽規則(S4-3);沒講才回到靜態值 —— 這是「條件式優先」的實作 */
    readonly: effect?.readonly ?? staticAttrs.readonly === true,
    /* 🔴 C-3|必填是**聯集**,不是覆蓋。

       與 readonly 不同 —— 官方對必填只說「如果一個欄位已套用欄位必填設定時,
       設定條件式格式時則**無法選擇該必填欄位**」(即設計期就排除),
       **沒有**「條件式優先於欄位屬性」那句(那句只給唯讀)。
       故靜態必填仍然必填,規則只能**再加上**必填,不能把它拿掉。
       ⚠️ 但被規則隱藏時整個略過 —— 見 `skipValidation`。 */
    required: !hiddenByRule && (staticAttrs.required === true || effect?.required === true),
    skipValidation: hiddenByRule,
  }
}

/* 🔴 C-3|動作按鈕與「開始簽核」的效果(Ragic 官方逐字,§0.2)。

   > 「你也可以透過條件式格式來顯示、隱藏或上鎖動作按鈕(包含合併列印按鈕和
   > 客製列印報表按鈕)……如果是要**上鎖**動作按鈕的話,還可以**客製提醒訊息**。」
   > 「你可以透過條件式格式來設定簽核規則決定是否顯示或隱藏「開始簽核」按鈕。」

   動詞與分段那組**完全一樣**(顯示 / 隱藏 / 上鎖),故沿用同一組效果:
   `hide` = 不顯示 · `readonly` = 上鎖 · 同一條規則上的 `message` = 客製提醒訊息。
   **不另立 `buttonHide` / `buttonLock`** —— 那會讓同一個心智動作有兩套名字。 */
export interface ActionGateState {
  readonly hidden: boolean
  readonly locked: boolean
  /* 上鎖時給使用者看的理由。沒設就由呼叫端給預設文字 —— **不要留空**,
     一個按不動又不說為什麼的按鈕,使用者只會一直按。 */
  readonly message: string | null
}

const OPEN: ActionGateState = { hidden: false, locked: false, message: null }

function gate(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
  applies: (rule: FormatRule) => boolean,
  ctx: EvalContext = {},
): ActionGateState {
  const known = new Set(fieldNames)
  let state = OPEN
  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (!applies(rule)) continue
    const effects = Array.isArray(rule.effects) ? rule.effects : []
    if (!ruleMatches(rule, values, known, ctx)) continue
    let hidden = state.hidden
    let locked = state.locked
    let message = state.message
    for (const e of effects) {
      if (e.kind === "hide") hidden = true
      else if (e.kind === "readonly") locked = true
      else if (e.kind === "message") message = renderMessage(e.text, values, known)
    }
    state = { hidden, locked, message }
  }
  return state
}

export function evaluateButtonGate(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
  buttonId: number,
  ctx: EvalContext = {},
): ActionGateState {
  return gate(rules, values, fieldNames, (r) => (r.targetButtons ?? []).includes(buttonId), ctx)
}

export function evaluateApprovalGate(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
  ctx: EvalContext = {},
): ActionGateState {
  return gate(rules, values, fieldNames, (r) => r.targetApproval === true, ctx)
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
/* 🔴 R1·C-6 A|求出這次儲存該跳的**警告**(規則層,不落在欄位上)。

   與 `evaluateMessages` 幾乎同形但**刻意分成兩支**:
   `message` 是顯示,`warn` 會改變儲存流程(先退回、確認後才過)。
   合成一支的話,呼叫端要靠 `kind` 再分一次,而**漏分的後果是把警告當成裝飾**。

   ⚠️ 這一支**伺服器也要跑** —— 只在前端跳確認的警告,打 API 就繞過去了,
   那就退化成 `message`。同 C-3 對條件式必填的裁定。 */
export function evaluateWarnings(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
  ctx: EvalContext = {},
): string[] {
  const known = new Set(fieldNames)
  const out: string[] = []
  for (const rule of rules) {
    if (rule.enabled === false) continue
    const effects = Array.isArray(rule.effects) ? rule.effects : []
    if (!effects.some((e) => e.kind === "warn")) continue
    if (!ruleMatches(rule, values, known, ctx)) continue
    for (const e of effects) {
      if (e.kind !== "warn") continue
      const text = renderMessage(e.text, values, known).trim()
      if (text !== "") out.push(text)
    }
  }
  return out
}

export function evaluateMessages(
  rules: readonly FormatRule[],
  values: RecordValues,
  fieldNames: readonly string[],
  ctx: EvalContext = {},
): string[] {
  const known = new Set(fieldNames)
  const out: string[] = []
  for (const rule of rules) {
    if (rule.enabled === false) continue
    const effects = Array.isArray(rule.effects) ? rule.effects : []
    if (!effects.some((e) => e.kind === "message")) continue
    if (!ruleMatches(rule, values, known, ctx)) continue
    for (const e of effects) {
      if (e.kind !== "message") continue
      const text = renderMessage(e.text, values, known).trim()
      if (text !== "") out.push(text)
    }
  }
  return out
}
