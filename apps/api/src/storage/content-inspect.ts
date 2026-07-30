import { inflateRawSync } from "node:zlib"

/* 🔴 F-11 M1|內容層檢查。**投報率高於 ClamAV,且不需要 4 GiB 常駐。**

   magic bytes(`file-type.ts`)只證明「開頭像某種格式」,證明不了內容安全。
   本檔補三個 [file-storage §殘留](../../../docs/modules/foundation/file-storage.md)
   已點名、但一直沒做的破口:

   1. **OOXML 巨集** —— `.docm` 改名 `.docx` 仍是巨集檔,magic bytes 一樣是 PK
   2. **PDF 主動內容** —— `/JavaScript` `/OpenAction` `/Launch` `/EmbeddedFile`
   3. **polyglot 尾部** —— PNG/WebP 未旋轉時位元組原封,**尾部附加的 ZIP 完整存活**
      (zip 讀取器從檔尾找中央目錄)

   ## 為什麼先做這些

   研究對 ClamAV 的誠實評價:官方自陳「不是傳統防毒」,Splunk 實測偵測率 59.94%,
   且它擋不住「純資料型攻擊」。而上面三項正好都是純資料型 —— ClamAV 不一定攔得住,
   這裡卻幾十行就擋掉。

   ## 刻意的限制

   - **原則上只讀中央目錄**;唯一的例外是 `[Content_Types].xml`(見 `readEntryText`),
     且輸出硬性限制 64KB —— 與「解開整包」不是一回事,zip bomb 的攻擊面在後者
   - 全部只掃前後有限位元組,不做完整解析 —— 我們不是要寫一個 PDF parser */

export interface InspectVerdict {
  readonly ok: boolean
  readonly reason?: string
}

const OK: InspectVerdict = { ok: true }

/* ── OOXML ────────────────────────────────────────────────────────────────
   zip 的中央目錄在檔尾:EOCD(`PK\x05\x06`)→ 目錄起點 → 逐筆讀檔名。
   只讀檔名,不讀內容、不解壓。 */

const EOCD_SIG = 0x0605_4b50
const CEN_SIG = 0x0201_4b50
/* EOCD 最小 22 bytes;comment 最長 65535 → 從檔尾往回找的上限 */
const EOCD_SEARCH = 22 + 0xff_ff

function findEocd(buf: Buffer): number {
  const start = Math.max(0, buf.length - EOCD_SEARCH)
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

export function listZipEntryNames(buf: Buffer, limit = 2000): string[] | null {
  const eocd = findEocd(buf)
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  const centralSize = buf.readUInt32LE(eocd + 12)
  /* 🔴 中央目錄起點要**由檔尾回推**,不能直接用 EOCD 記的 offset。

     zip 附加在別的檔案後面時(polyglot),記載的 offset 是相對於 zip 自身起點,
     與它在整個檔案中的絕對位置差了一個前綴長度。真實的 zip 讀取器都會回推 ——
     若我們不回推,就會**比攻擊者手上的解壓工具更無能**:解析不到就以為安全。
     實測正是如此:PNG+ZIP 的 polyglot 用記載 offset 讀不到任何條目。 */
  const derived = eocd - centralSize
  let offset =
    derived >= 0 && buf.readUInt32LE(derived) === CEN_SIG ? derived : buf.readUInt32LE(eocd + 16)
  const names: string[] = []
  for (let i = 0; i < Math.min(count, limit); i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) break
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const nameStart = offset + 46
    if (nameStart + nameLen > buf.length) break
    names.push(buf.toString("utf8", nameStart, nameStart + nameLen))
    offset = nameStart + nameLen + extraLen + commentLen
  }
  return names
}

/* 🔴 巨集偵測。**檔名不是可靠的判準。**

   最初只比對 `vbaProject.bin` 這個檔名,實測發現可繞:OPC 規範允許 part 用
   **任意名稱**,型別由 `[Content_Types].xml` 的 Override 宣告。
   把 part 命名為 `word/x.bin` 但宣告 `application/vnd.ms-office.vbaProject`,
   Office 照樣載入巨集,而檔名檢查完全看不到。

   這個洞是手刻造成的 —— `oletools`(olevba)這類既有工具判的是**型別與結構**
   而非檔名。改為以宣告的 content type 為主、檔名為輔。

   一併涵蓋 **Excel 4.0 / XLM 巨集**(`macrosheet`)—— 它不住在 vbaProject 裡,
   是已知的規避手法。 */
const MACRO_ENTRY = /(^|\/)vbaProject\.bin$/i
const MACRO_CONTENT_TYPES = ["vbaProject", "macroEnabled", "macrosheet"] as const

export function inspectOoxml(buf: Buffer): InspectVerdict {
  const names = listZipEntryNames(buf)
  if (names === null) return { ok: false, reason: "無法解析 Office 檔案結構" }
  if (names.some((n) => MACRO_ENTRY.test(n))) {
    return { ok: false, reason: "檔案含巨集(vbaProject.bin),基於安全考量不接受" }
  }
  /* [Content_Types].xml 宣告 macroEnabled 的檔案即使沒有 vbaProject 也拒 ——
     它宣告了自己是巨集格式,沒有理由讓它進來。

     🔴 這一項**必須解壓才讀得到**(zip 內容是 deflate 過的,直接在原始位元組
     搜字串搜不到)。但只解**這一個條目**且硬性限制輸出大小 —— 與「解開整包」
     是兩回事,zip bomb 的攻擊面在後者。 */
  if (names.includes("[Content_Types].xml")) {
    const xml = readEntryText(buf, "[Content_Types].xml")
    /* 🔴 讀不到就**拒絕**,不是放行。讀不到代表「無法確認這個檔沒有巨集」,
       而 fail-open 正是把「不確定」當成「安全」。實務上 OOXML 的
       [Content_Types].xml 只會是 stored 或 deflate,解不開本身就可疑。 */
    if (xml === null) {
      return { ok: false, reason: "無法讀取 Office 檔案的型別宣告,請以 Office 另存後再上傳" }
    }
    const hit = MACRO_CONTENT_TYPES.find((k) => xml.includes(k))
    if (hit !== undefined) {
      return { ok: false, reason: `檔案宣告含巨集內容(${hit}),基於安全考量不接受` }
    }
  }
  return OK
}

/* 解壓單一條目,輸出硬上限 64KB([Content_Types].xml 實務上 <2KB)。
   解不開就回 null —— 讀不到宣告不等於有巨集,那由 vbaProject 檢查負責。 */
const ENTRY_MAX_BYTES = 64 * 1024

function readEntryText(buf: Buffer, wanted: string): string | null {
  const eocd = findEocd(buf)
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  const centralSize = buf.readUInt32LE(eocd + 12)
  const derived = eocd - centralSize
  let offset =
    derived >= 0 && buf.readUInt32LE(derived) === CEN_SIG ? derived : buf.readUInt32LE(eocd + 16)
  const prefix = derived >= 0 && buf.readUInt32LE(derived) === CEN_SIG
    ? derived - buf.readUInt32LE(eocd + 16)
    : 0

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) return null
    const method = buf.readUInt16LE(offset + 10)
    const compSize = buf.readUInt32LE(offset + 20)
    const rawSize = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42) + prefix
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen)

    if (name === wanted) {
      if (rawSize > ENTRY_MAX_BYTES || compSize > ENTRY_MAX_BYTES) return null
      if (localOffset + 30 > buf.length) return null
      const localNameLen = buf.readUInt16LE(localOffset + 26)
      const localExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      /* 只接受 stored(0)與 deflate(8)。實務上 OOXML 只用這兩種,
         其餘(deflate64 / bzip2 / LZMA…)出現在這裡本身就可疑,而且
         盲目丟給 inflateRawSync 可能「剛好解得開」而給出錯誤的安全感。 */
      if (method !== 0 && method !== 8) return null
      const data = buf.subarray(dataStart, dataStart + compSize)
      try {
        const out = method === 0 ? data : inflateRawSync(data, { maxOutputLength: ENTRY_MAX_BYTES })
        return out.toString("utf8")
      } catch {
        return null
      }
    }
    offset = offset + 46 + nameLen + extraLen + commentLen
  }
  return null
}

/* ── PDF ──────────────────────────────────────────────────────────────────

   關鍵字表**對照 PDFiD(Didier Stevens)的實際原始碼**,不是憑印象列。
   PDFiD 標為 risky 並在 disarm 時處理的是:
   `/JS` `/JavaScript` `/AA` `/OpenAction` `/JBIG2Decode` `/RichMedia` `/Launch`;
   另監控 `/AcroForm` `/EmbeddedFile` `/XFA` `/ObjStm` `/Encrypt`。

   ## 🔴 這個做法有結構性上限,必須講明

   我們掃的是**原始位元組**。PDF 1.5 起的 `/ObjStm`(物件流)會把物件
   **壓縮**起來 —— 放在裡面的 `/JavaScript` 在原始位元組中根本不存在,
   這個掃描看不到。PDFiD 有同樣的限制,那正是它把 `/ObjStm` 列為訊號的原因。

   **但 `/ObjStm` 不能拒**:現代 PDF 幾乎都有(壓縮 xref 是預設行為),
   拒了等於拒掉大部分正常檔案。`/Encrypt` 同理 —— 加密的請款單在 ERP 場景很常見。

   → **這正是 ClamAV 仍然有價值的地方**:它會解析 PDF 結構、解開物件流,
   做我們這裡做不到的事。兩者是**互補而非替代** ——
   malware-scanning.md §1.3 的定位描述應據此修正。 */

/* 拒絕:這些在 ERP 附件情境幾乎沒有正當用途,而漏判的代價是「開啟即執行」 */
const PDF_DANGEROUS = [
  "/JavaScript",
  "/JS",
  "/OpenAction",
  "/AA",
  "/Launch",
  "/EmbeddedFile",
  "/RichMedia",
  "/JBIG2Decode", // CVE-2009-0658 等一系列解碼器漏洞的入口
  "/XFA", // Adobe 專有表單,已被多個 RCE 利用
] as const

/* 不拒、但代表「這個檔的內容我們掃不完全」。留給 scan_status 與 ClamAV 處理。
   `/AcroForm` 是可填寫表單的正常構件(報價單常見),拒了誤傷太大。 */
const PDF_OPAQUE = ["/ObjStm", "/Encrypt"] as const

export interface PdfVerdict extends InspectVerdict {
  /* true 代表原始位元組掃描不足以下結論(物件流 / 加密),需要真正的解析器 */
  readonly opaque?: boolean
}

export function inspectPdf(buf: Buffer): PdfVerdict {
  const text = buf.toString("latin1")
  const hit = PDF_DANGEROUS.find((k) => text.includes(k))
  if (hit !== undefined) {
    return { ok: false, reason: `PDF 含主動內容(${hit}),基於安全考量不接受` }
  }
  return { ok: true, opaque: PDF_OPAQUE.some((k) => text.includes(k)) }
}

/* ── polyglot 尾部 ────────────────────────────────────────────────────────
   影像格式有明確結尾標記,之後不應該還有資料。附加在後面的 ZIP 會被 zip
   讀取器找到(它從檔尾找中央目錄),形成「看起來是圖、也真的是壓縮檔」的 polyglot。

   目前靠 `octet-stream + attachment + nosniff` 擋住觸發,但那是**易碎的安全** ——
   任何一處改成 inline 或直出 CDN 就破功。在入口擋掉才是結構性的。 */

const TRAILING_SLACK = 16

/* 影像裡不該存在 zip 中央目錄。這是對 polyglot 的**直接**檢查,
   而尾部長度只是輔助。

   🔴 為什麼需要這一條:JPEG 的結尾偵測是向後找最後一個 `FFD9`,
   攻擊者只要讓附加的 ZIP **以 `FFD9` 結尾**,end 就會等於檔案長度、
   尾部長度為 0 而通過 —— 但 zip 讀取器仍從檔尾找得到中央目錄,polyglot 存活。
   直接問「這裡面有沒有 zip」才擋得住,且不依賴任何格式的結尾偵測是否精準。 */
function looksLikeZip(buf: Buffer): boolean {
  const eocd = findEocd(buf)
  if (eocd < 0) return false
  const centralSize = buf.readUInt32LE(eocd + 12)
  const derived = eocd - centralSize
  /* 同時要求中央目錄真的在那裡 —— 只比對 4 bytes 簽章會有偶然誤判 */
  return derived >= 0 && derived + 4 <= buf.length && buf.readUInt32LE(derived) === CEN_SIG
}

export function inspectImageTail(buf: Buffer, mime: string): InspectVerdict {
  if (looksLikeZip(buf)) {
    return { ok: false, reason: "影像檔內含壓縮檔結構(polyglot),不接受" }
  }
  const end = imageEndOffset(buf, mime)
  if (end === null) return OK
  const trailing = buf.length - end
  if (trailing > TRAILING_SLACK) {
    return {
      ok: false,
      reason: `影像結尾後仍有 ${String(trailing)} 位元組資料(可能是附加的壓縮檔),不接受`,
    }
  }
  return OK
}

function imageEndOffset(buf: Buffer, mime: string): number | null {
  if (mime === "image/png") {
    // IEND chunk:長度(4)+ "IEND"(4)+ CRC(4)
    const idx = buf.lastIndexOf(Buffer.from("IEND", "latin1"))
    return idx < 0 ? null : idx + 8
  }
  if (mime === "image/jpeg") {
    // EOI marker FFD9
    for (let i = buf.length - 2; i >= 0; i -= 1) {
      if (buf[i] === 0xff && buf[i + 1] === 0xd9) return i + 2
    }
    return null
  }
  if (mime === "image/gif") {
    const idx = buf.lastIndexOf(0x3b) // trailer ';'
    return idx < 0 ? null : idx + 1
  }
  if (mime === "image/webp") {
    // RIFF 標頭第 4 byte 起為 chunk size(不含前 8 bytes)
    if (buf.length < 12) return null
    return 8 + buf.readUInt32LE(4)
  }
  return null
}

/* ── 統一入口 ─────────────────────────────────────────────────────────── */

export function inspectContent(buf: Buffer, mime: string): InspectVerdict {
  if (mime === "application/pdf") return inspectPdf(buf)
  if (mime.startsWith("image/")) return inspectImageTail(buf, mime)
  if (
    mime.startsWith("application/vnd.openxmlformats-officedocument") ||
    mime === "application/zip"
  ) {
    return inspectOoxml(buf)
  }
  return OK
}
