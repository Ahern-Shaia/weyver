/* F-5 檔案 metadata 契約。attachment 欄值沿用既有 `[{key,name}]`(零欄型變更,設計 doc §7.2)。 */

export interface FileDto {
  readonly key: string
  readonly name: string
  readonly mime: string
  readonly size: number
}

export type FileStatus = "pending" | "bound" | "orphaned"

/* 可掛檔案的欄位型別(R1·UP-4b 加入 image / signature)。 */
export const ATTACHMENT_FIELD_TYPES: ReadonlySet<string> = new Set([
  "attachment",
  "image",
  "signature",
])

/* R1·UP-4b|**依欄型收斂可接受之 MIME**(OQ-IS-1 之安全面):
   影像類欄位只收影像 —— 圖片欄收到 PDF 會在 UI 破圖,且無謂擴大該欄攻擊面。
   attachment 維持完整白名單。 */
const IMAGE_ONLY_FIELD_TYPES: ReadonlySet<string> = new Set(["image", "signature"])

export function isMimeAllowedForField(fieldType: string, mime: string): boolean {
  if (!IMAGE_ONLY_FIELD_TYPES.has(fieldType)) return true
  return mime.startsWith("image/")
}

/* RFC 5987:原始檔名以 UTF-8 百分比編碼帶出(檔名不入路徑,只入標頭)。 */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
