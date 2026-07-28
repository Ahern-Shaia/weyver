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

/* 🔴 CSV / 試算表公式注入(OWASP CSV Injection)。

   儲存型攻擊:上傳一份首格為 `=cmd|'/c calc'!A1` 的 CSV,同租戶同事下載後
   用 Excel 開啟即觸發 DDE。型別白名單擋不住 —— 它是合法的 CSV。
   本平台客戶天天用 Excel,這條路徑是實的。

   偵測而非改寫:上傳的是**使用者的原始檔案**,靜默改內容會破壞資料。
   由呼叫端決定拒收或標警示。 */
const FORMULA_LEAD = /^[\s\uFEFF]*[=+\-@\t\r]/

export function hasSpreadsheetFormula(buf: Buffer): boolean {
  /* 只看前 64KB —— 攻擊要生效必須在使用者會看到的前幾列 */
  const head = buf.subarray(0, 65_536).toString("utf8")
  return head.split(/\r?\n/).some((line) =>
    line.split(",").some((cell) => FORMULA_LEAD.test(cell.replace(/^"/, ""))),
  )
}

/* 🔴 顯示用檔名淨化。

   **RTL 覆寫偽裝**:含 `U+202E`(RIGHT-TO-LEFT OVERRIDE)的 `發票\u202Egpj.exe`
   在下載清單與檔案總管中**顯示為** `發票exe.jpg` —— 使用者以為是圖片而執行。
   header 注入本身已由百分比編碼擋住,但**顯示層的偽裝沒擋**。

   一併處理:Unicode 正規化(避免同形異碼)、控制字元、Windows 保留名、
   尾端點與空白(Windows 會靜默去除,導致副檔名判定與實際落差)。 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 剝除控制字元正是本函式的目的
const BIDI_AND_CONTROL = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u0000-\u001F\u007F]/g
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i

export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .normalize("NFC")
    .replace(BIDI_AND_CONTROL, "")
    /* 路徑分隔字元:key 由伺服器生成故無穿越風險,但顯示名不該帶路徑 */
    .replace(/[/\\]/g, "_")
    .replace(/[\s.]+$/, "")
    .slice(0, 255)
  if (cleaned === "") return "未命名檔案"
  return WINDOWS_RESERVED.test(cleaned) ? `_${cleaned}` : cleaned
}
