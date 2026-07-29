import type { CellValueType } from "./field-type-registry.js"

/* 🔴 轉換的 SQL 運算式(#105,深研見 field-types-parity.md §0-ter B)。

   **dry-run 與執行必須共用同一段運算式** —— 這是「預覽即結果」的唯一保證
   (Flyway 的 dry-run 同原理)。兩處各寫一份必然漂移,而使用者是照預覽做決策的。

   **例外收窄**|Baserow 用 `exception when others`,會把 `statement_timeout`
   這類**非資料問題**也吞成 NULL —— 使用者會看到「300 筆被清空」卻不知道
   其實是逾時。此處只捕資料類錯誤,其餘照拋。 */

const DATA_ERRORS = [
  "invalid_text_representation",
  "numeric_value_out_of_range",
  "datetime_field_overflow",
  "invalid_datetime_format",
  "division_by_zero",
].join("\n      OR ")

/* 🔴 日期格式必須釘死白名單。
   本專案已踩過 pg DATE parser 的位移 bug;且 PG 的寬鬆 date input 會依
   `DateStyle` 把 `01/02/03` 解成完全不同的日期。**無法以指定格式解析者一律計為清空**,
   即使 PG 自己猜得出來 —— 猜對一次不值得,猜錯一次是永久的。 */
export const DATE_FORMATS = ["YYYY-MM-DD", "YYYY/MM/DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

export interface CastOptions {
  readonly dateFormat?: DateFormat | undefined
  /** number → money 必須顯式指定,不可推斷 */
  readonly currency?: string | undefined
  readonly ratingMax?: number | undefined
  readonly choices?: readonly string[] | undefined
}

/* 回傳一段 SQL 運算式。

   **column 直接內插而非走 `??`**:此運算式會被嵌進 count 查詢裡重複三次,
   用 knex 佔位符會讓 binding 數量極難對齊(實作時踩到)。
   內插是安全的 —— column 來自 `physicalColumnName(fieldId)`,由系統生成並經
   `^[a-z_][a-z0-9_]{0,62}$` 驗證,使用者輸入永遠不會出現在 identifier 位置(鐵則 1)。
   **值仍一律參數綁定。** */
/* identifier 驗證 + 引號。column 由 `physicalColumnName(fieldId)` 系統生成,
   此處是縱深第二道(鐵則 1:使用者輸入永不進入 identifier 位置)。 */
export function quoteColumn(column: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(column)) {
    throw new Error(`illegal column identifier: ${JSON.stringify(column)}`)
  }
  return `"${column}"`
}

/* 🔴 哪些轉換會在遇到壞值時**整句拋錯**。
   這是最容易漏的一點:`"f1"::numeric` 只要有一筆 "N/A" 就讓整個 ALTER 失敗,
   而使用者手上的舊 Excel 幾乎必有 "N/A" / "待確認" 之類的值。
   這些路徑必須包進 try_cast,轉不動的個別回 NULL 而非整批失敗。 */
export function needsTryCast(from: CellValueType, to: CellValueType): boolean {
  const textish = from === "text" || from === "longText"
  if (!textish) return false
  return to === "number" || to === "money" || to === "percent" || to === "date" || to === "dateTime"
}

export function castExpression(
  from: CellValueType,
  to: CellValueType,
  valueExpr: string,
  options: CastOptions,
): { sql: string; bindings: readonly unknown[] } {
  const col = valueExpr

  if (to === "multiSelect" && from === "singleSelect") {
    return { sql: `CASE WHEN ${col} IS NULL THEN NULL ELSE ARRAY[${col}] END`, bindings: [] }
  }
  if (from === "multiSelect" && to === "singleSelect") {
    // Baserow 先例:多選轉單選保留第一個而非整批拒絕
    return { sql: `${col}[1]`, bindings: [] }
  }
  if (to === "text" || to === "longText") {
    if (from === "checkbox") {
      /* 字面值固定為 true/false 並記錄於此 —— 若跟隨語系,同一批資料
         會因伺服器語系而產出不同字串,日後再轉回 checkbox 就對不上。 */
      return { sql: `CASE WHEN ${col} THEN 'true' WHEN ${col} IS NULL THEN NULL ELSE 'false' END`, bindings: [] }
    }
    if (from === "date" || from === "dateTime") {
      return { sql: `to_char(${col}, 'YYYY-MM-DD')`, bindings: [] }
    }
    if (from === "number" || from === "money" || from === "percent") {
      /* 欄位是 numeric(19,4),直接 ::text 會得到 `42.0000` —— 無損但難看,
         而使用者把數字欄轉成文字時期待看到的是 `42`。
         trim_scale(PG 13+)只去掉小數部分的尾零,不會把 `100` 變成 `1`。 */
      return { sql: `trim_scale(${col})::text`, bindings: [] }
    }
    return { sql: `${col}::text`, bindings: [] }
  }
  if (to === "number" || to === "money" || to === "percent") {
    return { sql: `${col}::numeric`, bindings: [] }
  }
  if (to === "rating") {
    const max = options.ratingMax ?? 5
    return { sql: `least(greatest(round(${col}::numeric), 0), ?)::int2`, bindings: [max] }
  }
  if (to === "date") {
    if (from === "dateTime") return { sql: `${col}::date`, bindings: [] }
    return { sql: `to_date(${col}, ?)`, bindings: [options.dateFormat ?? DATE_FORMATS[0]] }
  }
  if (to === "dateTime") {
    return { sql: `to_timestamp(${col}, ?)`, bindings: [options.dateFormat ?? DATE_FORMATS[0]] }
  }
  if (to === "checkbox") {
    /* 真值字面白名單;不在其中者一律 NULL(不猜) */
    return {
      sql: `CASE WHEN lower(${col}) IN ('true','1','y','yes','是','v') THEN true
                 WHEN lower(${col}) IN ('false','0','n','no','否','x') THEN false
                 ELSE NULL END`,
      bindings: [],
    }
  }
  if (to === "singleSelect") {
    const choices = options.choices ?? []
    return { sql: `CASE WHEN ${col} = ANY(?) THEN ${col} ELSE NULL END`, bindings: [[...choices]] }
  }
  return { sql: col, bindings: [] }
}

/* 建一次性的 try_cast 函式:轉不動回 NULL,但**只吞資料類錯誤**。
   建在 pg_temp 以免數百萬個函式殘留(Baserow 的作法,這點值得抄)。 */
export function tryCastFunctionSql(
  name: string,
  pgType: string,
  inner: string,
): string {
  return `CREATE OR REPLACE FUNCTION pg_temp.${name}(v text) RETURNS ${pgType} AS $$
BEGIN
  BEGIN
    RETURN ${inner};
  EXCEPTION WHEN ${DATA_ERRORS}
  THEN RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE`
}
