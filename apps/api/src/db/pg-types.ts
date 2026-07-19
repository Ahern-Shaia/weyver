import pg from "pg"

/* pg 型別解析覆寫(全域,import 即生效):
   - DATE(1082):預設會轉成 JS Date(本地午夜 → JSON 時位移時區、丟失「純日期」語意)。
     表單引擎 date 欄應原樣回 "YYYY-MM-DD" 字串。 */
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value)
