import { isStubType } from "@/lib/engine/field-types"
import type { FieldDto } from "@/lib/engine/schemas"

/* 純值轉換(無 JSX,可單元測):填單 state ↔ 後端型別 */

/* 🔴 選項清單。**必須同時吃 v1 字串與 v2 物件** ——
   #105 把 `options.choices` 從 `["甲","乙"]` 改成 `[{id,name,color?,retired?}]`,
   但這個讀取端沒跟上,導致填單的單選/多選下拉、篩選面板、看板分欄**全部拿到空清單**
   (使用者根本選不了值)。實走看板時才浮現 —— 型別上 `unknown` 讓它靜默通過。

   `retired`(軟停用)不出現在可選清單:新記錄不該再選到停用值;
   但既有值仍會被 formatFieldValue 正常顯示,不會憑空消失。 */
export function choicesOf(field: FieldDto): string[] {
  const raw = (field.options as { choices?: unknown }).choices
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => {
      if (typeof c === "string") return c
      if (typeof c === "object" && c !== null) {
        const o = c as { name?: unknown; retired?: unknown }
        if (o.retired === true) return ""
        return typeof o.name === "string" ? o.name : ""
      }
      return ""
    })
    .filter((n) => n !== "")
}

/* 送出前值轉換:回傳 undefined = 略過(不送);money 保字串禁 float,數值轉 number */
export function toSubmitValue(field: FieldDto, value: unknown): unknown {
  if (isStubType(field.type) || field.type === "autoNumber" || field.type === "formula")
    return undefined
  switch (field.type) {
    // F-5 附件 / R1·UP-4b 影像類:[{key,name}];空陣列不送(避免覆寫既有值語意不清)
    case "attachment":
    case "image":
    case "signature":
      return Array.isArray(value) && value.length > 0 ? value : undefined
    case "checkbox":
      return value === true
    case "multiSelect":
      return Array.isArray(value) && value.length > 0 ? value : undefined
    case "number":
    case "percent":
    case "rating": {
      if (typeof value !== "string" || value.trim() === "") return undefined
      const n = Number(value)
      return Number.isFinite(n) ? n : value // 非數字原樣送,交後端 422
    }
    /* 🔴 member 存 actor id(number)。不能落到 default 的字串分支 ——
       否則「指派誰」會在送出邊界被靜默丟掉,畫面上明明選了人,存進去卻是空的
       (#96 瀏覽器實走發現)。null = 明確取消指派,與「沒碰過」不同。 */
    case "member":
      if (value === null) return null
      return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
    case "money":
      return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
    case "dateTime": {
      if (typeof value !== "string" || value === "") return undefined
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? value : d.toISOString()
    }
    default: {
      if (typeof value !== "string") return undefined
      const trimmed = value.trim()
      return trimmed === "" ? undefined : trimmed
    }
  }
}

/* 記錄值顯示(檢視):後端回值 → 可讀字串。
   members = actor id → 姓名(#96);未帶時 member 欄退回顯示 id,不會壞掉。 */
/* 帶入欄的兩個引擎標記(後端 record.service):必須翻成人看得懂的字 ——
   直接把 __source_deleted__ 印在單據上等於沒處理。兩者刻意分開:
   「來源不見了」是資料事故要追,「無權檢視」是正常的權限結果。 */
const SOURCE_MARKERS: Record<string, string> = {
  __source_deleted__: "來源已刪除",
  __source_restricted__: "無權檢視",
}

export function formatFieldValue(
  field: FieldDto,
  value: unknown,
  members?: ReadonlyMap<number, string>,
): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string" && value in SOURCE_MARKERS) return SOURCE_MARKERS[value] ?? value
  /* bigint 經 pg 回傳為字串,兩種都要吃 */
  if (field.type === "member") {
    const id = typeof value === "number" ? value : Number(value)
    return members?.get(id) ?? String(value)
  }
  if (field.type === "checkbox") return value === true ? "是" : "否"
  if (field.type === "multiSelect" && Array.isArray(value)) return value.join("、")
  if (
    (field.type === "attachment" || field.type === "image" || field.type === "signature") &&
    Array.isArray(value)
  ) {
    const names = value.map((v) =>
      typeof v === "object" && v !== null && "name" in v
        ? String((v as { name: unknown }).name)
        : "",
    )
    return names.filter((n) => n !== "").join("、") || "—"
  }
  if (field.type === "dateTime" && typeof value === "string") {
    return value.replace("T", " ").slice(0, 19)
  }
  return String(value)
}
