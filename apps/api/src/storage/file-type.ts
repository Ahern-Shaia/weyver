/* F-5 檔案型別驗證(docs/22:**magic bytes 驗型別,非副檔名**)。
   白名單:圖片 / PDF / Office(zip 容器)/ 純文字-CSV。
   不符 → 拒(415),絕不「靜默改名放行」。 */

export interface DetectedType {
  readonly mime: string
  readonly ext: string
}

interface Signature {
  readonly mime: string
  readonly ext: string
  readonly offset: number
  readonly bytes: readonly number[]
}

/* 位元組簽章表(取常見且客戶單據會用到者) */
const SIGNATURES: readonly Signature[] = [
  { mime: "image/png", ext: ".png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", ext: ".jpg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", ext: ".gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", ext: ".webp", offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  { mime: "application/pdf", ext: ".pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  // Office OOXML(docx/xlsx/pptx)皆為 zip 容器 → 以 PK 簽章 + 副檔名細分
  { mime: "application/zip", ext: ".zip", offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
]

/* zip 容器之 OOXML 細分(僅以宣告副檔名收斂 mime;容器本身已由 magic bytes 確認) */
const OOXML: Readonly<Record<string, string>> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

/* 純文字類無 magic bytes → 僅在宣告副檔名為 txt/csv 且內容不含 NUL 時放行 */
const TEXT_EXT: Readonly<Record<string, string>> = {
  ".txt": "text/plain",
  ".csv": "text/csv",
}

function matches(buf: Buffer, sig: Signature): boolean {
  if (buf.length < sig.offset + sig.bytes.length) return false
  return sig.bytes.every((b, i) => buf[sig.offset + i] === b)
}

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".")
  return i < 0 ? "" : filename.slice(i).toLowerCase()
}

/* 依內容(magic bytes)判定型別;回 null = 不在白名單 → 呼叫端拒 415。
   declaredExt 僅用於 zip/純文字之細分,**不作為型別依據**。 */
export function detectType(buf: Buffer, filename: string): DetectedType | null {
  const declaredExt = extensionOf(filename)
  for (const sig of SIGNATURES) {
    if (!matches(buf, sig)) continue
    if (sig.mime === "application/zip") {
      const mime = OOXML[declaredExt]
      // 未宣告 OOXML 副檔名之 zip 一律拒(避免任意壓縮檔挾帶)
      return mime === undefined ? null : { mime, ext: declaredExt }
    }
    return { mime: sig.mime, ext: sig.ext }
  }
  const textMime = TEXT_EXT[declaredExt]
  if (textMime !== undefined && !buf.includes(0)) {
    return { mime: textMime, ext: declaredExt }
  }
  return null
}
