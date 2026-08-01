import type { FieldDto } from "./schemas"

/* 🔴 R1·UP-3c M1|設計模式的**示例值**(OQ-FDW-1=A 依型別生成)。

   ## 為什麼不取真實記錄

   取該表第一筆真實資料看起來更「真」,但有兩個問題:
   · **權限**|設計者未必有讀資料權;E-1 欄位級權限下更明顯 —— 設計畫面會變成
     一條繞過權限的讀取路徑。
   · **空表**|剛建的表沒有資料,而那正是最需要看見版面的時刻。

   依型別生成沒有資料路徑、對每個型別都成立、且**永遠可用**。

   ## 為什麼不顯示空白

   看不出欄寬與換行 —— 那正是「設計看不出填起來長怎樣」要解掉的問題。

   ⚠️ 呈現端必須讓它**看得出是示例**(ink-3 + 斜紋淡底),否則使用者會以為是真資料。 */

const TODAY = (): Date => new Date()

const pad = (n: number): string => String(n).padStart(2, "0")

function dateStr(d: Date): string {
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function firstChoice(field: Pick<FieldDto, "options">): string | null {
  const raw = (field.options as { choices?: unknown } | undefined)?.choices
  if (!Array.isArray(raw) || raw.length === 0) return null
  const first: unknown = raw[0]
  if (typeof first === "string") return first
  if (typeof first === "object" && first !== null && "label" in first) {
    const label = (first as { label?: unknown }).label
    if (typeof label === "string") return label
  }
  return null
}

/* 型別 → 示例值。**用該欄自己的選項**(若有)優先於通用字樣 ——
   使用者設了「合格 / 不合格」卻看到「選項一」會更困惑。 */
export function sampleValue(field: Pick<FieldDto, "type" | "options" | "name">): string {
  const now = TODAY()
  switch (field.type) {
    case "text":
      return "範例文字"
    case "longText":
      return "範例的多行說明文字，用來看清楚欄位的寬度與換行。"
    /* ⚠️ email / url / phone 初版漏列,落到 default 回「範例文字」——
       由「不得有型別落到 default」那條測試當場抓到。型別驅動的漏列不會報錯,只會安靜地退回預設。 */
    case "email":
      return "name@example.com"
    case "url":
      return "https://example.com"
    case "phone":
      return "0912-345-678"
    case "number":
      return "1,234"
    case "money":
      return "128,400.00"
    case "percent":
      return "50%"
    case "date":
      return dateStr(now)
    case "dateTime":
    case "createdAt":
    case "updatedAt":
      return `${dateStr(now)} 09:12`
    case "createdBy":
    case "updatedBy":
    case "member":
      return "王小明"
    case "singleSelect":
      return firstChoice(field) ?? "選項一"
    case "multiSelect": {
      const c = firstChoice(field)
      return c === null ? "選項一、選項二" : `${c}、…`
    }
    case "checkbox":
      return "是"
    case "rating":
      return "★★★☆☆"
    case "autoNumber":
      return "AUTO-000001"
    case "attachment":
      return "範例檔案.pdf"
    case "image":
      return "範例圖片.jpg"
    case "signature":
      return "（已簽名）"
    case "barcode":
      return "4710085120697"
    case "link":
      return "（關聯記錄）"
    /* 計算類:值由引擎算出,設計時無法預期 —— 誠實顯示它是算出來的,不編一個假數字 */
    case "formula":
    case "rollup":
    case "lookup":
      return "（計算值）"
    default:
      return "範例文字"
  }
}

/* 需要等寬對齊的示例值(金額 / 數量 / 日期 / 代碼)—— 與 display-value 的 NUMERIC 判準同源。 */
const MONO_TYPES = new Set([
  "number",
  "money",
  "percent",
  "date",
  "dateTime",
  "createdAt",
  "updatedAt",
  "autoNumber",
  "barcode",
])

export function sampleIsMono(type: string): boolean {
  return MONO_TYPES.has(type)
}
