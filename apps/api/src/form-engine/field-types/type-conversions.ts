import type { CellValueType } from "./field-type-registry.js"

/* OQ-FEC-4 = A|保守白名單:只允許「物理型別不變 + 語意放寬」的轉換(零 DDL、零 rewrite,
   純 metadata 變更);其餘一律拒絕,指引建新欄搬資料。spike S2:rewrite 型 DDL 會鎖讀者。 */

const SAFE_CONVERSIONS: ReadonlyMap<CellValueType, readonly CellValueType[]> = new Map([
  ["text", ["longText"]],
  ["email", ["text", "longText"]],
  ["url", ["text", "longText"]],
  ["phone", ["text", "longText"]],
  ["singleSelect", ["text", "longText"]],
])

export function isSafeConversion(from: CellValueType, to: CellValueType): boolean {
  if (from === to) return true
  return SAFE_CONVERSIONS.get(from)?.includes(to) ?? false
}
