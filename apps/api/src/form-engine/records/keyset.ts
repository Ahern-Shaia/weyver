import type { Knex } from "knex"

/* 🔴 複合 keyset 分頁(#95)。

   **原本的 bug**|排序是 `ORDER BY sortCol, id`,續頁條件卻是 `WHERE id > cursor`。
   兩者對不起來 —— 依「狀態」排序時第一頁可能回 id [50, 3, 88],
   續頁用 `id > 88` 會把 id 1–87 **整批跳過**,而使用者完全看不出少了東西。

   **為什麼不用 offset**|offset 在深頁是 O(n),而且併發寫入時同樣會跳列/重複 ——
   用一種靜默錯誤換另一種不划算。

   **為什麼不用 PG 的 row-value 比較 `(a,b) > (x,y)`**|它要求所有欄同方向、
   且 NULL 語意固定,與本專案的「混合 asc/desc + NULLS LAST」不相容。

   遞迴展開的述詞(以 NULLS LAST 為前提):
   - asc,last 非 NULL → `col > v OR col IS NULL OR (col = v AND <次鍵>)`
   - asc,last 為 NULL → `col IS NULL AND <次鍵>`(NULL 已在最尾,只剩同為 NULL 的)
   - desc 同理,`>` 換 `<` */

export interface SortKey {
  readonly column: string
  readonly dir: "asc" | "desc"
}

export interface CursorPayload {
  /** 各排序鍵在最後一列的值(順序與 sort 相同) */
  readonly v: readonly unknown[]
  /** id 尾鍵 —— 保證全序,否則同值列會在頁與頁之間漂移 */
  readonly id: number
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

export function decodeCursor(token: string): CursorPayload | null {
  try {
    const raw: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
    if (typeof raw !== "object" || raw === null) return null
    const { v, id } = raw as { v?: unknown; id?: unknown }
    if (!Array.isArray(v) || typeof id !== "number" || !Number.isSafeInteger(id)) return null
    return { v, id }
  } catch {
    /* 壞掉的權杖回 null → 呼叫端當作「從頭開始」。
       比拋錯好:權杖可能來自舊版前端或被截斷的網址,使用者只會看到列表壞掉。 */
    return null
  }
}

/* 遞迴組出「排在 cursor 之後」的條件。index 為目前處理到第幾個排序鍵。 */
function after(
  builder: Knex.QueryBuilder,
  keys: readonly SortKey[],
  values: readonly unknown[],
  idColumn: string,
  id: number,
  index: number,
): void {
  const key = keys[index]
  if (key === undefined) {
    // 排序鍵用盡 → 只剩 id 尾鍵
    void builder.where(idColumn, ">", id)
    return
  }
  const value = values[index] ?? null
  const strictly = key.dir === "asc" ? ">" : "<"

  if (value === null) {
    /* last 是 NULL:NULLS LAST 之下它已排在最尾,後面只可能是同為 NULL 的列 */
    void builder.where((g: Knex.QueryBuilder) => {
      void g.whereNull(key.column).andWhere((t: Knex.QueryBuilder) => {
        after(t, keys, values, idColumn, id, index + 1)
      })
    })
    return
  }

  void builder.where((g: Knex.QueryBuilder) => {
    void g
      .where(key.column, strictly, value)
      // NULL 排在最尾 → 非 NULL 的 last 之後必然包含所有 NULL
      .orWhereNull(key.column)
      .orWhere((tie: Knex.QueryBuilder) => {
        void tie.where(key.column, "=", value).andWhere((t: Knex.QueryBuilder) => {
          after(t, keys, values, idColumn, id, index + 1)
        })
      })
  })
}

export function applyKeyset(
  builder: Knex.QueryBuilder,
  keys: readonly SortKey[],
  cursor: CursorPayload,
  idColumn: string,
): Knex.QueryBuilder {
  after(builder, keys, cursor.v, idColumn, cursor.id, 0)
  return builder
}
