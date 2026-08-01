import { createWriteStream } from "node:fs"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import * as archiverModule from "archiver"
import type { Archiver } from "archiver"
import { UTF8_BOM, csvRow } from "./csv.js"

/* ⚠️ `@types/archiver@8` 的型別與 `archiver@7` 的執行期**對不上**:
   型別宣告 `export class ZipArchive`,但 `require("archiver")` 實際拿到的是一個
   函式(掛著 `create` / `registerFormat`),沒有 `ZipArchive` 這個匯出。
   照型別寫會 tsc 全綠、一跑就 `ZipArchive is not a constructor` ——
   這一版是**先被測試抓到才發現**的,不是照著文件猜出來的。
   故取執行期確實存在的 `create()`;轉型無可避免,理由如上。 */
const createArchive = (
  archiverModule as unknown as { create: (f: string, o?: unknown) => Archiver }
).create

/* 🔴 R1·I-1|封存檔的產生。

   ## 為什麼寫到暫存檔而不是組在記憶體裡

   一個租戶的全部記錄不保證裝得進記憶體 —— 而「裝不下」這件事會在**最大的那個客戶**
   身上第一次發生,也就是最不能出事的時候。故:記錄逐頁讀 → 逐列寫進 zip 串流 →
   落到暫存檔;任何時刻在記憶體裡的只有一頁。

   ⚠️ **已知限制**:`StorageDriver.put()` 只收 `Buffer`,所以最後上傳那一刻仍會把
   整個 zip 讀進記憶體一次。M1 不改介面(那會動到既有的檔案上傳路徑),改以**大小上限**
   兜住;真正的解是給 driver 加 `putStream`,列為殘留。

   ## 為什麼一表一個 CSV 而不是一個大 CSV

   動態 schema 平台每張表的欄位都不同,合併就得取聯集,結果是一張到處是空格的稀疏表。
   一表一檔,型別與欄位定義由 `manifest.json` 補齊(OQ-EX-7=A)。 */

export interface ExportFormSpec {
  readonly formId: number
  readonly name: string
  /* 欄位顯示名,決定 CSV 的欄序 —— manifest 與 CSV 必須用**同一份順序** */
  readonly columns: readonly string[]
  /* manifest 用:型別 / 選項 / 關聯 */
  readonly fields: readonly Record<string, unknown>[]
}

export interface ExportSource {
  /* 逐頁取記錄。回 null cursor 代表結束。實作端負責租戶隔離與欄位級權限。 */
  readPage(
    formId: number,
    cursor: string | null,
  ): Promise<{ rows: readonly Record<string, unknown>[]; nextCursor: string | null }>
}

export interface ArchiveResult {
  readonly path: string
  readonly sizeBytes: number
  readonly rowCount: number
  /* 呼叫端上傳完務必呼叫,否則暫存檔會留在磁碟上 */
  cleanup(): Promise<void>
}

/* 檔名安全:表單名可以是任何使用者輸入,不能直接當檔名(路徑穿越 / 保留字 / 長度)。
   撞名時加 formId 後綴 —— 同名的兩張表在 zip 裡必須是兩個檔,不能互相覆蓋。 */
export function archiveEntryName(name: string, formId: number, taken: Set<string>): string {
  const cleaned = name
    /* 🔴 明確列出禁用字元。原本寫成 `[ -/…]`(ASCII range 空白..斜線)——
       看不出它涵蓋了哪些字元,而測試顯示 `.` 沒有如預期被換掉。
       路徑穿越靠的正是 `.` 與 `/`,這種地方不能用「應該有涵蓋到」的寫法。

       控制字元(含 RTL 覆寫那一類)一併剝除 —— 與 `safeDisplayName()` 同一個理由:
       檔名是會被人眼判讀的東西,偽裝成別的副檔名就會有人點下去。
       連字號不動:`採購單-A` 是正常且可讀的檔名,沒有理由弄花它。 */
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 剝除控制字元正是本行的目的
    .replace(/[.\\/:*?"<>|\u0000-\u001F ]/g, "_")
    .trim()
    .slice(0, 80)
  /* 全是被換掉的字元(例如表單名只有空白或標點)→ `___.csv` 對收件人毫無意義,
     退回可辨識的 `form_<id>`,再由 manifest 對回原名。 */
  const meaningful = cleaned.replace(/_/g, "") !== ""
  const base = meaningful ? cleaned : `form_${String(formId)}`
  const unique = taken.has(base) ? `${base}_${String(formId)}` : base
  taken.add(unique)
  return unique
}

export async function buildArchive(input: {
  readonly tenantName: string
  readonly forms: readonly ExportFormSpec[]
  readonly source: ExportSource
  /* 未壓縮位元組上限。壓縮後通常小一個數量級,但**上限要管的是產生成本**
     (記憶體 / 磁碟 / DB 負載),那是未壓縮的量。 */
  readonly maxBytes: number
  readonly generatedAt: Date
}): Promise<ArchiveResult> {
  const dir = await mkdtemp(join(tmpdir(), "weyver-export-"))
  const path = join(dir, "export.zip")
  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true })
  }

  const out = createWriteStream(path)
  const zip = createArchive("zip", { zlib: { level: 9 } })
  const done = new Promise<void>((resolve, reject) => {
    out.on("close", resolve)
    out.on("error", reject)
    zip.on("error", reject)
  })
  zip.pipe(out)

  let rowCount = 0
  /* 🔴 大小上限**自己數**。原本掛 archiver 的 `progress` 事件,但那個事件的
     `fs.processedBytes` 只涵蓋「來源是檔案系統」的 entry —— 我方每一個 entry
     都是 PassThrough,數字恆為 0,上限形同虛設。測試抓到的。
     每一列都經過這裡,所以自己累加是精確的(未壓縮位元組)。 */
  let uncompressedBytes = 0
  const taken = new Set<string>()
  const manifestForms: Record<string, unknown>[] = []

  try {
    for (const form of input.forms) {
      const entry = archiveEntryName(form.name, form.formId, taken)
      const stream = new PassThrough()
      zip.append(stream, { name: `forms/${entry}.csv` })

      const emit = (text: string): void => {
        uncompressedBytes += Buffer.byteLength(text)
        if (uncompressedBytes > input.maxBytes) throw new Error("EXPORT_TOO_LARGE")
        stream.write(text)
      }
      emit(UTF8_BOM)
      emit(csvRow(["id", ...form.columns]))
      let cursor: string | null = null
      do {
        const page = await input.source.readPage(form.formId, cursor)
        for (const row of page.rows) {
          const values = form.columns.map((c) => (row.values as Record<string, unknown> | undefined)?.[c])
          emit(csvRow([row.id, ...values]))
          rowCount += 1
        }
        cursor = page.nextCursor
      } while (cursor !== null)
      stream.end()

      manifestForms.push({
        formId: form.formId,
        name: form.name,
        file: `forms/${entry}.csv`,
        fields: form.fields,
      })
    }

    zip.append(
      JSON.stringify(
        {
          weyverExportVersion: 1,
          tenant: input.tenantName,
          generatedAt: input.generatedAt.toISOString(),
          forms: manifestForms,
        },
        null,
        2,
      ),
      { name: "manifest.json" },
    )
    zip.append(README, { name: "README.txt" })

    await zip.finalize()
    await done
  } catch (error) {
    zip.abort()
    await cleanup()
    throw error
  }

  const size = await stat(path)
  return { path, sizeBytes: size.size, rowCount, cleanup }
}

/* 收件人不一定是工程師 —— 這份說明的讀者可能是被要求「把資料交出來」的行政人員。 */
const README = `Weyver 資料匯出

forms/*.csv    每張表單一個檔案,第一欄為記錄 id。
manifest.json  各表單的欄位定義(型別、選項、關聯)。CSV 不帶型別,要還原資料請看這份。

編碼為 UTF-8(含 BOM),分隔符為逗號,換行為 CRLF(RFC 4180)。
以 = + - @ 開頭的儲存格前面會多一個單引號 —— 那是防止試算表把資料當公式執行,
原始內容不含該引號。
`
