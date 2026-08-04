import { type DateFormatKey, DATE_FORMATS } from "./display-value"

/* 🔴 R1·FMT M3|日期的**寬鬆解析**與月曆格運算。純函式,無 React,可單元測。

   ## 為什麼要自己解析

   原生 `<input type="date">` 只吃 `yyyy-MM-dd`,而且**格式由瀏覽器語系決定**
   (量測見模組文件 §0.3-bis)。它同時輸掉兩件事:格式一致、可以打字。

   Ragic 的日期欄接受 `20151022` / `1022` / `22`,官方逐字:
   ·「輸入值 `20151022` → 格式化後 `2015/10/22`」
   ·「`1022` → **如果你沒有輸入年份,會用現在的年份補上**」
   ·「`22` → **如果你只有輸入日子,會用現在的年份、月份來自動補齊**」
   (設計手冊 doc/51「欄位格式」,查證 2026-08-04)

   ## 一個容易寫錯的地方

   Ragic 的例子裡,格式 `dd-MM-yyyy` 之下輸入 `1022` 得到 `22-10-2015` ——
   看起來像「依格式順序解析」,其實不是:它把 `1022` 解成 **MM=10 / dd=22**,
   只是**顯示**時才照 `dd-MM` 重排。
   所以**緊湊數字一律是 y→M→d 的順序**,與欄位格式無關。
   ⚠️ 若誤做成「依格式解析」,`dash` 欄位的 `1022` 會變成 10 月 22 日以外的日期,
   而使用者不會發現 —— 那是靜默的錯資料。

   ## 月曆格為什麼全用字串

   `calendar-view.tsx` 已經用純字串運算月曆格以避開 `Date` 的時區陷阱。
   本檔把那三個函式抽出來共用 —— **不是再寫一份**(兩份會漂移,M1 剛修過同型問題)。 */

export function ymd(y: number, m: number, d: number): string {
  return `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function weekdayOfFirst(y: number, m: number): number {
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
}

/* 指定時區的「今天」。**不可用 `new Date().getFullYear()`** —— 那是執行環境的時區,
   跨日時會補出錯的年月(而使用者不會發現)。 */
export function todayYmd(timeZone?: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date())
  return p
}

function valid(y: number, m: number, d: number): boolean {
  return (
    Number.isInteger(y) &&
    y >= 1 &&
    y <= 9999 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= daysInMonth(y, m)
  )
}

export type ParseResult = { ok: true; value: string } | { ok: false }

/* 寬鬆解析 → 正規 `yyyy-MM-dd`。`today` 為 `yyyy-MM-dd`(呼叫端以顯示時區取得)。

   🔴 **解析不出來就回 `ok:false`,絕不「盡力猜一個」** ——
   `field-types-parity.md:409` 對 `text → date` 已裁定過同一件事:
   「無法以指定格式解析者一律計入 will_be_nulled,**即使 PG 自己猜得出來**」。
   靜默的猜測比拒絕更糟:使用者看不到系統改了什麼。 */
export function parseLooseDate(raw: string, today: string): ParseResult {
  const s = raw.trim()
  if (s === "") return { ok: false }
  const [ty = "", tm = ""] = today.split("-")

  const digits = /^\d+$/.test(s)
  if (digits) {
    if (s.length === 8) {
      const y = Number(s.slice(0, 4))
      const m = Number(s.slice(4, 6))
      const d = Number(s.slice(6, 8))
      return valid(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false }
    }
    if (s.length === 4) {
      /* MMdd —— 與欄位格式無關(見檔頭)。年份補今年。 */
      const y = Number(ty)
      const m = Number(s.slice(0, 2))
      const d = Number(s.slice(2, 4))
      return valid(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false }
    }
    if (s.length <= 2) {
      const y = Number(ty)
      const m = Number(tm)
      const d = Number(s)
      return valid(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false }
    }
    /* 6 碼(`260305`)刻意**不支援**:兩位年份要猜世紀,而猜錯不會有人發現。
       Ragic 官方例子也沒有這一種。 */
    return { ok: false }
  }

  const parts = s.split(/[/\-.\s]+/).filter((x) => x !== "")
  if (parts.length === 2) {
    /* 沒有年份 → 補今年,順序同緊湊寫法(M→d) */
    const y = Number(ty)
    const m = Number(parts[0])
    const d = Number(parts[1])
    return valid(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false }
  }
  if (parts.length === 3) {
    /* 🔴 用「哪一段是四位數」判年份位置,**不依欄位格式** ——
       `2026-03-05` 與 `05-03-2026` 都能吃,而且不會因為欄位換了格式就解出不同的日期。 */
    const [a = "", b = "", c = ""] = parts
    const yearFirst = a.length === 4
    const y = Number(yearFirst ? a : c)
    const m = Number(b)
    const d = Number(yearFirst ? c : a)
    return valid(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false }
  }
  return { ok: false }
}

/* 正規 `yyyy-MM-dd` → 依欄位格式的顯示字串。`local` 交給 `Intl`。 */
export function formatYmd(value: string, format: DateFormatKey, locale?: string): string {
  const [y = "", m = "", d = ""] = value.split("-")
  if (y === "" || m === "" || d === "") return value
  switch (format) {
    case "iso":
      return `${y}-${m}-${d}`
    case "slash":
      return `${y}/${m}/${d}`
    case "dash":
      return `${d}-${m}-${y}`
    case "dot":
      return `${y}.${m}.${d}`
    default:
      /* 🔴 用 `Date.UTC` 建構再指定 `timeZone: "UTC"` 格式化 ——
         直接 `new Date("2026-03-05")` 會被當成 UTC 午夜,在 UTC-N 的時區印成前一天。
         這個位移 bug 本專案已經踩過一次(pg DATE parser),不再踩第二次。 */
      return new Intl.DateTimeFormat(locale ?? "zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))))
  }
}

export function dateFormatOfField(options: unknown): DateFormatKey {
  const raw = (options as { dateFormat?: unknown } | undefined)?.dateFormat
  return typeof raw === "string" && (DATE_FORMATS as readonly string[]).includes(raw)
    ? (raw as DateFormatKey)
    : "local"
}

/* 月曆格:回傳 6×7 的 `yyyy-MM-dd`,跨月的格子為 null(不畫鄰月日期,
   避免使用者點到隔壁月而不自覺)。 */
export function monthGrid(y: number, m: number): (string | null)[] {
  const lead = weekdayOfFirst(y, m)
  const total = daysInMonth(y, m)
  const cells: (string | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push(ymd(y, m, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/* 在月曆上位移 n 天,回傳新的 `yyyy-MM-dd`(可跨月跨年)。 */
export function shiftDays(value: string, n: number): string {
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + n)
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/* 位移 n 個月,日超出當月天數時**夾到月底**(3/31 往前一個月 → 2/28,不溢位到 3/3)。 */
export function shiftMonths(value: string, n: number): string {
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}
