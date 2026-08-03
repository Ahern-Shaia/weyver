/* 🔴 R1·GP M2|貼上矩陣正規化(docs/modules/R1/grid-paste.md §0.2)。

   **這裡沒有 TSV parser,是刻意的。** Glide Data Grid 已經解析好才交給 `onPaste`
   —— 它優先讀剪貼簿的 `text/html`(`decodeHTML`),沒有才退回 `unquote()`,
   而 `unquote` 是正規的引號狀態機,含換行的儲存格、跳脫引號、CRLF 都處理了。
   自己再寫一份只會比較差(這正是「巨人的肩膀」第二站的教訓)。

   本層只做套件**不做、而我們非做不可**的三件事。 */

/* 與後端 `BULK_MAX_UPDATE_ROWS` 同值(OQ-GP-2,Smartsheet 官方明文 500 列/次)。
   前端先擋是為了給得出「貼了 N 列、上限 500」這種話;後端仍會再擋一次。 */
export const PASTE_MAX_ROWS = 500

export interface PasteMatrix {
  readonly rows: readonly (readonly string[])[]
  readonly cols: number
}

export type PasteMatrixResult =
  | { readonly ok: true; readonly matrix: PasteMatrix }
  | { readonly ok: false; readonly reason: "empty" }
  | { readonly ok: false; readonly reason: "corrupt" }
  | { readonly ok: false; readonly reason: "tooManyRows"; readonly rowCount: number }

/* 落單的代理碼元 = 上游解析已經位移。
   `unquote` 以 `for...of` 逐**碼點**迭代卻只把 index 加 1,而 `slice` 走**碼元**,
   故剪貼簿含 astral 字元(emoji 等)時整塊資料會錯位。
   已於 @glideapps/glide-data-grid@6.0.3 實測重現:
   `"🙂\tB\nC\tD"` → `[["\ud83d","\t"],["\n","\tD"]]`。
   走 text/html 的來源(Excel / Google 試算表)不受影響,純文字來源才會踩到。
   修不了上游就**讓它可見** —— 靜默寫進錯的值正是本模組 §0.3(c) 列為反面教材的那件事。 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

export function normalizePasteMatrix(
  values: readonly (readonly string[])[],
  maxRows: number = PASTE_MAX_ROWS,
): PasteMatrixResult {
  /* Excel 複製的最後一格帶換行 → 上游會多吐一列空的。
     不砍掉的話「貼 2 列」會變成「將新增 1 列」的幽靈提示。 */
  let end = values.length
  while (end > 0 && isBlankRow(values[end - 1])) end--
  const trimmed = values.slice(0, end)

  if (trimmed.length === 0 || trimmed.every(isBlankRow)) return { ok: false, reason: "empty" }
  if (trimmed.some((r) => r.some((c) => LONE_SURROGATE.test(c)))) {
    return { ok: false, reason: "corrupt" }
  }
  if (trimmed.length > maxRows)
    return { ok: false, reason: "tooManyRows", rowCount: trimmed.length }

  /* 補成矩形 —— 後續的先驗與錯誤格標示都以 (row, col) 定位,鋸齒狀會讓索引對不上欄 */
  const cols = Math.max(...trimmed.map((r) => r.length))
  const rows = trimmed.map((r) =>
    r.length === cols ? [...r] : [...r, ...Array<string>(cols - r.length).fill("")],
  )
  return { ok: true, matrix: { rows, cols } }
}

function isBlankRow(row: readonly string[] | undefined): boolean {
  return row === undefined || row.every((c) => c === "")
}

export function describePasteRejection(result: PasteMatrixResult): string | null {
  if (result.ok) return null
  switch (result.reason) {
    case "empty":
      return "剪貼簿沒有可貼上的內容。"
    case "corrupt":
      return "剪貼簿內容含有無法正確解析的字元(如表情符號),整塊未貼上以免寫入錯誤的值。請改從 Excel 或 Google 試算表複製。"
    case "tooManyRows":
      return `一次最多貼上 ${String(PASTE_MAX_ROWS)} 列,這次是 ${String(result.rowCount)} 列。資料量較大請改用「匯入資料」。`
  }
}
