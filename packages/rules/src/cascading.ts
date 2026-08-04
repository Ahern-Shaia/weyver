/* R1·UP-4|**連動選項**(cascading select)的可選集合。

   🔴 為什麼住在共用套件裡:這個判斷同時決定**填單時下拉裡有什麼**與
   **伺服器收不收這個值**。只在前端過濾等於沒做(直接打 API 就繞過去),
   而兩份各自實作必然漂移 —— 那會變成「畫面上選得到、存下去被拒」。
   先例是 `@weyver/formula` 與本套件的條件式格式求值。

   ## 資料形狀(承 `field-type-registry` 的 v2 選項模型)

   - 子欄的 options:`{ parentField?: string, choices: [{ id, name, parents?: string[] }] }`
   - `parents` 存的是**父欄選項的 id**,不是名稱 —— id 穩定於改名(同 `loadMap` 的理由)
   - 而**記錄裡存的是選項名稱**(單選欄的值就是字串),
     故解析時必須拿父欄的 choices 把「名稱 → id」對回去。**這一層是最容易漏的。** */

export interface ChoiceLike {
  readonly id: string
  readonly name: string
  readonly retired?: boolean | undefined
  readonly parents?: readonly string[] | undefined
}

export interface SelectOptionsLike {
  readonly choices?: readonly ChoiceLike[] | undefined
  readonly parentField?: string | undefined
}

export function asSelectOptions(raw: unknown): SelectOptionsLike {
  if (typeof raw !== "object" || raw === null) return {}
  const o = raw as { choices?: unknown; parentField?: unknown }
  const choices = Array.isArray(o.choices)
    ? o.choices.filter((c): c is ChoiceLike => typeof c === "object" && c !== null && "name" in c)
    : undefined
  return {
    ...(choices === undefined ? {} : { choices }),
    ...(typeof o.parentField === "string" ? { parentField: o.parentField } : {}),
  }
}

/* 父欄目前的值(選項名稱)→ **可用來比對 `parents` 的兩個鍵**。

   🔴 `parents` 裡存的**不保證是 id**。v2(設計器寫入)存 id;
   而 v1 的 `optionParents: { 子選項名: [父選項名] }` 在正規化時,
   用的是**子欄自己的**「名稱→id」對照表去查父選項名 —— 查不到就原樣留下,
   於是舊資料與遷移輸入裡存的是**父選項的名稱**。
   (`field-type-registry` 的註解說它會轉成 id,那句話對子欄成立、對父欄不成立。)

   兩者都吃,而不是挑一邊:挑 id 會讓舊資料的連動靜默失效,
   挑名稱則會在父選項改名後失效 —— 而改名正是當初選 id 的理由。 */
function parentKeys(parentOptions: SelectOptionsLike, parentValue: unknown): Set<string> {
  if (typeof parentValue !== "string" || parentValue === "") return new Set()
  const hit = (parentOptions.choices ?? []).find((c) => c.name === parentValue)
  if (hit === undefined) return new Set()
  return new Set([hit.id, hit.name])
}

/* 🔴 可選集合。判準只有三條,刻意不多:

   1. 子欄沒設 `parentField` → **全部可選**(沒有連動這回事)
   2. 某個選項沒有 `parents` → **恆可選**(它不受父欄限制;
      這讓「共用選項」不必逐一列出所有父,也讓既有資料零遷移)
   3. 有 `parents` → 父欄目前的選項 id 必須在其中;**父欄沒填就都不可選**
      —— 那正是連動的用意:先選大類才選得到小類 */
export function allowedChoices(
  childOptions: SelectOptionsLike,
  parentOptions: SelectOptionsLike,
  parentValue: unknown,
): ChoiceLike[] {
  const all = (childOptions.choices ?? []).filter((c) => c.retired !== true)
  if (childOptions.parentField === undefined || childOptions.parentField === "") return all
  const keys = parentKeys(parentOptions, parentValue)
  return all.filter((c) => {
    if (c.parents === undefined || c.parents.length === 0) return true
    return c.parents.some((p) => keys.has(p))
  })
}

/* 伺服器端的判斷:這個值在目前的父欄值之下允不允許。

   ⚠️ **停用(retired)的選項不在此把關** —— 既有記錄仍持有它,
   而軟停用的語意是「新記錄不可選、舊值保留可讀」。那一關屬於別的地方,
   混進來會讓一筆老資料因為改了別的欄位就存不回去。 */
export function isChoiceAllowed(
  childOptions: SelectOptionsLike,
  parentOptions: SelectOptionsLike,
  parentValue: unknown,
  value: string,
): boolean {
  if (childOptions.parentField === undefined || childOptions.parentField === "") return true
  const choice = (childOptions.choices ?? []).find((c) => c.name === value)
  /* 不在 choices 裡的值不歸這裡管(既有資料 / 型別驗證另有把關) */
  if (choice === undefined) return true
  if (choice.parents === undefined || choice.parents.length === 0) return true
  const keys = parentKeys(parentOptions, parentValue)
  return choice.parents.some((p) => keys.has(p))
}
