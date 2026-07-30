import { deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { inspectContent, inspectOoxml, inspectPdf, listZipEntryNames } from "./content-inspect.js"

/* 🔴 F-11 M1。**樣本是真的組出來的 zip / PNG / PDF 位元組**,不是假字串 ——
   這些檢查的價值全在「能不能解析真實結構」,用假資料測等於沒測。 */

/* ── 最小可用 zip 建構器(只需中央目錄正確,不需真的可解壓)────────────── */
function buildZip(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const compressed = deflateRawSync(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x0403_4b50, 0)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x0201_4b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x0605_4b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd])
}

const CONTENT_TYPES_PLAIN =
  '<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
const CONTENT_TYPES_MACRO =
  '<?xml version="1.0"?><Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

describe("zip 中央目錄解析(只讀檔名,不解壓)", () => {
  it("讀得出檔名", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES_PLAIN) },
      { name: "word/document.xml", data: Buffer.from("<w/>") },
    ])
    expect(listZipEntryNames(zip)).toEqual(["[Content_Types].xml", "word/document.xml"])
  })

  it("不是 zip 就回 null,不擲錯", () => {
    expect(listZipEntryNames(Buffer.from("not a zip at all"))).toBeNull()
  })
})

describe("OOXML 巨集偵測", () => {
  it("乾淨的 docx 放行", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES_PLAIN) },
      { name: "word/document.xml", data: Buffer.from("<w/>") },
    ])
    expect(inspectOoxml(zip).ok).toBe(true)
  })

  /* 🔴 這是 file-storage §殘留點名的破口:`.docm` 改名 `.docx`,
     magic bytes 一樣是 PK,副檔名檢查也過 —— 只有讀內部結構才擋得住。 */
  it("🔴 含 vbaProject.bin 的檔案被拒(即使副檔名是 .docx)", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES_PLAIN) },
      { name: "word/vbaProject.bin", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) },
    ])
    const verdict = inspectOoxml(zip)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/巨集/)
  })

  it("🔴 只宣告 macroEnabled 但沒有 vbaProject 也被拒", () => {
    const zip = buildZip([{ name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES_MACRO) }])
    expect(inspectOoxml(zip).ok).toBe(false)
  })

  /* 🔴 手刻造成的漏洞,實測才發現:OPC 允許 part 用任意名稱,
     型別由 [Content_Types].xml 的 Override 宣告 —— 只比對檔名擋不住。
     `oletools` 這類既有工具判的是型別與結構,不是檔名。 */
  it("🔴 vbaProject 用非標準 part 名稱(OPC 允許)→ 仍被拒", () => {
    const ct =
      '<?xml version="1.0"?><Types><Override PartName="/word/x.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'
    const zip = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from(ct) },
      { name: "word/x.bin", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) },
    ])
    const verdict = inspectOoxml(zip)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/vbaProject/)
  })

  /* Excel 4.0 / XLM 巨集不住在 vbaProject 裡,是已知的規避手法 */
  it("🔴 Excel 4.0(XLM)巨集表 → 被拒", () => {
    const ct =
      '<?xml version="1.0"?><Types><Override PartName="/xl/macrosheets/sheet1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/></Types>'
    const zip = buildZip([{ name: "[Content_Types].xml", data: Buffer.from(ct) }])
    expect(inspectOoxml(zip).ok).toBe(false)
  })

  it("🔴 型別宣告讀不到 → 拒絕而非放行(不確定不等於安全)", () => {
    const zip = buildZip([{ name: "word/document.xml", data: Buffer.from("<w/>") }])
    // 有 [Content_Types].xml 之名但實際缺席的情況由上面涵蓋;這裡測「宣告解不開」
    const withCt = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: Buffer.from("<w/>") },
    ])
    withCt.writeUInt16LE(9, 8) // 竄改壓縮方法為 deflate64 → 解不開
    const eocd = withCt.length - 22
    const centralStart = withCt.readUInt32LE(eocd + 16)
    withCt.writeUInt16LE(9, centralStart + 10)
    expect(inspectOoxml(withCt).ok).toBe(false)
    // 沒有 [Content_Types].xml 的 zip 不在此規則內(交由其他檢查)
    expect(inspectOoxml(zip).ok).toBe(true)
  })

  it("透過 inspectContent 走 docx mime 也擋得住", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES_PLAIN) },
      { name: "xl/vbaProject.bin", data: Buffer.from("x") },
    ])
    expect(inspectContent(zip, DOCX_MIME).ok).toBe(false)
  })
})

describe("PDF 主動內容", () => {
  const pdf = (body: string): Buffer => Buffer.from(`%PDF-1.7\n${body}\n%%EOF`, "latin1")

  it("一般 PDF 放行", () => {
    expect(inspectPdf(pdf("1 0 obj << /Type /Catalog >> endobj")).ok).toBe(true)
  })

  it.each([
    ["/JavaScript", "1 0 obj << /S /JavaScript /JS (app.alert\\(1\\)) >> endobj"],
    ["/OpenAction", "1 0 obj << /OpenAction 2 0 R >> endobj"],
    ["/Launch", "1 0 obj << /S /Launch /F (calc.exe) >> endobj"],
    ["/EmbeddedFile", "1 0 obj << /Type /EmbeddedFile >> endobj"],
  ])("🔴 含 %s 的 PDF 被拒", (_label, body) => {
    const verdict = inspectPdf(pdf(body))
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/主動內容/)
  })
})

describe("polyglot 尾部資料", () => {
  const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const iend = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("IEND", "latin1"),
    Buffer.from([0xae, 0x42, 0x60, 0x82]),
  ])

  it("正常 PNG 放行", () => {
    expect(inspectContent(Buffer.concat([PNG_HEAD, iend]), "image/png").ok).toBe(true)
  })

  /* 🔴 file-storage §殘留:「PNG/WebP 未旋轉時位元組原封 → 尾部附加的 ZIP 完整存活」。
     zip 讀取器從檔尾找中央目錄,所以這個檔同時是合法 PNG 與合法 ZIP。 */
  it("🔴 PNG 尾部附加 ZIP → 被拒", () => {
    const zip = buildZip([{ name: "payload.txt", data: Buffer.from("evil") }])
    const polyglot = Buffer.concat([PNG_HEAD, iend, zip])
    const verdict = inspectContent(polyglot, "image/png")
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/壓縮檔結構|附加的壓縮檔/)
    // 而且那個 polyglot 確實是可被 zip 讀取器解析的(證明威脅為真,不是臆測)
    expect(listZipEntryNames(polyglot)).toEqual(["payload.txt"])
  })

  it("🔴 JPEG 尾部附加資料 → 被拒", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from([0xff, 0xd9]),
      Buffer.alloc(500, 0x41),
    ])
    expect(inspectContent(jpeg, "image/jpeg").ok).toBe(false)
  })

  /* 🔴 繞法測試:JPEG 的結尾偵測是向後找最後一個 FFD9,
     所以只要讓附加的 ZIP **以 FFD9 結尾**,尾部長度就會是 0 而通過。
     必須靠「影像內不得有 zip 中央目錄」這條直接檢查才擋得住。 */
  it("🔴 附加的 ZIP 以 FFD9 結尾 → 仍被拒(尾部長度檢查在此無效)", () => {
    const zip = buildZip([{ name: "payload.txt", data: Buffer.from("evil") }])
    const evil = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from([0xff, 0xd9]),
      zip,
      Buffer.from([0xff, 0xd9]), // 讓結尾偵測誤判成「剛好結束」
    ])
    expect(inspectContent(evil, "image/jpeg").ok).toBe(false)
  })

  it("少量對齊用的尾隨位元組不誤判", () => {
    const padded = Buffer.concat([PNG_HEAD, iend, Buffer.alloc(4)])
    expect(inspectContent(padded, "image/png").ok).toBe(true)
  })
})

describe("不認識的型別不擋(交由既有白名單把關)", () => {
  it("text/csv 放行", () => {
    expect(inspectContent(Buffer.from("a,b\n1,2"), "text/csv").ok).toBe(true)
  })
})
