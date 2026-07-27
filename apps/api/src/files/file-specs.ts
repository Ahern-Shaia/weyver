/* F-5 檔案 metadata 契約。attachment 欄值沿用既有 `[{key,name}]`(零欄型變更,設計 doc §7.2)。 */

export interface FileDto {
  readonly key: string
  readonly name: string
  readonly mime: string
  readonly size: number
}

export type FileStatus = "pending" | "bound" | "orphaned"

/* 可掛附件的欄位型別。image / signature 為 field-types-parity P1(解鎖後加入)。 */
export const ATTACHMENT_FIELD_TYPES: ReadonlySet<string> = new Set(["attachment"])

/* RFC 5987:原始檔名以 UTF-8 百分比編碼帶出(檔名不入路徑,只入標頭)。 */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
