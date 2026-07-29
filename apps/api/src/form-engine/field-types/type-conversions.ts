import type { CellValueType } from "./field-type-registry.js"

/* 🔴 型別轉換四態(#105,深研見 field-types-parity.md §0-ter B)。

   **原本是二態**(safe 白名單 5 條 / 其餘一律拒),方向正確 —— 比 Airtable 的
   「盡力轉、轉不動直接清空」安全,貼近 Salesforce 的「只轉沒資料的欄」。
   但缺 parity 常用路徑,而研究推翻了原本打算補的「三態」:

   **(a) 缺「safe 但需要 DDL」**|`singleSelect → multiSelect`(text → text[])
   語意零損失但要 rewrite + ACCESS EXCLUSIVE。既不屬 safe(零 DDL),
   也不該進 lossy(沒東西會丟)→ 必須獨立成一態。

   **(b) 缺「值會被改變」這一類**|Airtable 的真實事故不是清空而是**靜默改值**
   (大整數超過 2^53 被 JS 精度改掉),社群原話「it changes the data values...
   with no warning at all」。使用者對「清空 3 筆」的接受度遠高於
   「悄悄改了 10 萬筆的小數位」→ **dry-run 必須報兩個數字,不可合併。**

   **(c) Ragic 的型別轉換是非破壞性的**(官方 KB:改回去值就回來)——
   對標客戶的心智是「改型別可以隨便試」,故 forbidden 要盡量少;
   能用「保留原值 + 可還原」達成可逆的就不該拒絕。 */

export type ConversionKind = "safe-metadata" | "safe-rewrite" | "lossy" | "forbidden"

export interface ConversionRule {
  readonly kind: ConversionKind
  /** lossy 時說明會發生什麼,可直接當 UI 文案 */
  readonly note?: string
}

/* 物理型別不變、語意放寬 → 純 metadata 變更,零 DDL 零 rewrite。
   ⚠️ `singleSelect → text` 在此,是因為**本專案的資料欄存的是選項名稱**
   (§0-ter C 的設計 B)。若改成存 option id 這條就會失效 —— 兩案已交叉裁定。 */
const SAFE_METADATA: Readonly<Partial<Record<CellValueType, readonly CellValueType[]>>> = {
  text: ["longText"],
  email: ["text", "longText"],
  url: ["text", "longText"],
  phone: ["text", "longText"],
  singleSelect: ["text", "longText"],
  barcode: ["text", "longText"],
}

/* 語意零損失但物理型別改變 → 要 DDL + ACCESS EXCLUSIVE,無資料會丟。
   使用者只需知道「會鎖多久」,不需要 dry-run 預覽。 */
const SAFE_REWRITE: Readonly<Partial<Record<CellValueType, readonly CellValueType[]>>> = {
  singleSelect: ["multiSelect"],
  number: ["text", "longText"],
  money: ["text", "longText"],
  percent: ["text", "longText"],
  date: ["text", "longText"],
  dateTime: ["text", "longText"],
  checkbox: ["text", "longText"],
  rating: ["text", "longText", "number"],
}

/* 有資料會被清空**或被改變**。兩者嚴重度不同,dry-run 分開計數。 */
const LOSSY: Readonly<Partial<Record<CellValueType, readonly (readonly [CellValueType, string])[]>>> =
  {
    multiSelect: [["singleSelect", "每筆只會保留第一個選項,其餘丟棄"]],
    text: [
      ["number", "無法解析為數字的值會被清空"],
      ["money", "無法解析為金額的值會被清空;需指定幣別"],
      ["percent", "無法解析為數字的值會被清空"],
      ["date", "不符指定日期格式的值會被清空"],
      ["dateTime", "不符指定日期時間格式的值會被清空"],
      ["checkbox", "無法辨識為真/假的值會被清空"],
      ["singleSelect", "未被選為選項的值會被清空"],
    ],
    longText: [
      /* 物理型別相同、資料不動,但 text 的長度上限較小 → 超長內容會變成
         「存得住但下次編輯過不了驗證」的值。不是清空,但使用者必須知道。 */
      ["text", "超過長度上限的內容仍保留,但該筆下次編輯時需先縮短"],
      ["number", "無法解析為數字的值會被清空"],
      ["date", "不符指定日期格式的值會被清空"],
    ],
    number: [
      ["money", "小數位可能被四捨五入;需指定幣別"],
      ["percent", "小數位可能被四捨五入"],
      ["rating", "超出評分上限的值會被夾到上限"],
    ],
    money: [["number", "小數位可能被四捨五入"]],
    dateTime: [["date", "時間部分會被丟棄"]],
  }

/* 明確拒絕。**理由必須是「保留下來也無意義」而非「懶得做」** ——
   Ragic 的可逆體驗是對標基準,forbidden 越多越像退步。
   系統維護 / 虛擬欄:值不由使用者寫入,轉過去沒有意義。
   附件 / 影像 / 簽名 / 關聯 / 成員:Airtable 與 Teable 官方皆明載轉入會全失。 */
const NON_CONVERTIBLE: ReadonlySet<CellValueType> = new Set<CellValueType>([
  "autoNumber",
  "formula",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "lookup",
  "rollup",
  "attachment",
  "image",
  "signature",
  "link",
  "member",
])

export function classifyConversion(from: CellValueType, to: CellValueType): ConversionRule {
  if (from === to) return { kind: "safe-metadata" }
  if (NON_CONVERTIBLE.has(from) || NON_CONVERTIBLE.has(to)) return { kind: "forbidden" }
  if (SAFE_METADATA[from]?.includes(to) === true) return { kind: "safe-metadata" }
  if (SAFE_REWRITE[from]?.includes(to) === true) return { kind: "safe-rewrite" }
  const lossy = LOSSY[from]?.find(([target]) => target === to)
  if (lossy !== undefined) return { kind: "lossy", note: lossy[1] }
  return { kind: "forbidden" }
}

/* 舊介面:只有零 DDL 那一態算「safe」(既有呼叫端語意不變) */
export function isSafeConversion(from: CellValueType, to: CellValueType): boolean {
  return classifyConversion(from, to).kind === "safe-metadata"
}
