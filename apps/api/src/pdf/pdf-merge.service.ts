import { Inject, Injectable, Logger } from "@nestjs/common"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import type { PdfMergeSkip } from "../db/schema.js"
import { FilesService } from "../files/files.service.js"

/* 單一附件的大小上限。超過就跳過而不是拖垮 worker ——
   一份 50MB 的掃描件併進採購單,對「印一張單」這個意圖是不成比例的。 */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
/* 併進來的總頁數上限。一份單據後面接八百頁附件,實務上不是任何人要的東西。 */
const MAX_MERGED_PAGES = 300

export interface AttachmentRef {
  readonly key: string
  readonly name: string
}

export interface MergeResult {
  readonly pdf: Buffer
  readonly skipped: readonly PdfMergeSkip[]
}

/* 🔴 R1·後續-2b M2 A3|把記錄的附件 PDF 併進單據。

   ## 授權一律走 `FilesService.openForDownload`

   那一支已經串起「表單檢視權 → 欄位可見性 → 記錄可讀 → 掃毒狀態必須 clean」
   整條鏈。這裡**不自己查 `file_object`** —— 繞過去就等於再寫一條授權路徑,
   而那條路遲早會漏掉其中一環(本 repo 的「值只要有第二個出口就會漏」)。
   取不到就當作跳過,原因記 `unavailable`,不去追究是哪一環擋的
   (回報「你沒有這個欄位的權限」本身就是資訊洩漏)。

   ## 解析的是**使用者上傳的不可信 PDF**

   `@cantoo/pdf-lib` 是純 JS(無原生碼),故沒有記憶體破壞那一類風險,
   但仍要防資源耗盡:單檔大小上限、總頁數上限、逐檔 try/catch。
   選 `@cantoo/pdf-lib` 而非上游 `pdf-lib` 的理由是維護狀態 ——
   上游自 2021-11 未發版(317 open issues),fork 近一個月發了 5 版。
   兩者皆 MIT(2026-08-06 逐檔讀 LICENSE 本文確認)。

   ## 失敗不讓整份工作倒

   單據本身沒問題卻拿不到 PDF,比拿到一份「附件少了三個」更糟。
   故逐檔失敗只記進 `skipped`,由 UI 明說 —— **不靜默**。 */
@Injectable()
export class PdfMergeService {
  private readonly logger = new Logger(PdfMergeService.name)

  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  async merge(
    tenantId: number,
    actorId: number,
    permissions: EffectivePermissions,
    base: Buffer,
    attachments: readonly AttachmentRef[],
  ): Promise<MergeResult> {
    if (attachments.length === 0) return { pdf: base, skipped: [] }

    const { PDFDocument } = await import("@cantoo/pdf-lib")
    const out = await PDFDocument.load(base)
    const skipped: PdfMergeSkip[] = []
    let merged = 0

    for (const ref of attachments) {
      if (merged >= MAX_MERGED_PAGES) {
        skipped.push({ name: ref.name, reason: "page-cap" })
        continue
      }
      const loaded = await this.readOne(tenantId, actorId, permissions, ref)
      if (typeof loaded === "string") {
        skipped.push({ name: ref.name, reason: loaded })
        continue
      }
      try {
        const src = await PDFDocument.load(loaded, { ignoreEncryption: false })
        const indices = src.getPageIndices().slice(0, MAX_MERGED_PAGES - merged)
        if (indices.length < src.getPageCount()) {
          skipped.push({ name: ref.name, reason: "page-cap" })
        }
        const pages = await out.copyPages(src, indices)
        for (const page of pages) out.addPage(page)
        merged += pages.length
      } catch (error) {
        /* 加密的 PDF 與壞掉的 PDF 對使用者是不同的訊息 —— 前者他可以自己
           解密後重傳,後者只能換一份檔案。

           判斷依訊息而非類別:2026-08-06 實測 `@cantoo/pdf-lib` 2.8.1 丟的是
           `EncryptedPDFError`,但它的 `.name` 仍是 `"Error"`(只有 constructor
           名字對得上),而 constructor 名字經打包後不可靠。訊息逐字為
           「Input document to `PDFDocument.load` is encrypted.」。 */
        const encrypted = String(error).includes("encrypt")
        skipped.push({ name: ref.name, reason: encrypted ? "encrypted" : "unreadable" })
      }
    }

    return { pdf: Buffer.from(await out.save()), skipped }
  }

  /* 回 Buffer 或跳過原因。**不 throw** —— 呼叫端要的是「這一個併不進來」
     而不是「整批停在這裡」。 */
  private async readOne(
    tenantId: number,
    actorId: number,
    permissions: EffectivePermissions,
    ref: AttachmentRef,
  ): Promise<Uint8Array | PdfMergeSkip["reason"]> {
    try {
      const opened = await this.files.openForDownload({ tenantId, actorId }, permissions, ref.key)
      if (opened.meta.mime !== "application/pdf") {
        /* Ragic 的合併也只吃 PDF / XLSX / PPTX(`doc/56` 周邊逐字);
           我方只做 PDF —— 把 XLSX 轉版面是另一個轉檔問題,不在此。 */
        opened.stream.destroy()
        return "not-pdf"
      }
      if (opened.meta.size > MAX_ATTACHMENT_BYTES) {
        opened.stream.destroy()
        return "too-large"
      }
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of opened.stream) {
        const buf = chunk as Buffer
        total += buf.byteLength
        /* metadata 的 size 可能與實際物件不符(F-5 已為此踩過一次)——
           以實際讀到的位元組再擋一次,否則上限形同虛設。 */
        if (total > MAX_ATTACHMENT_BYTES) {
          opened.stream.destroy()
          return "too-large"
        }
        chunks.push(buf)
      }
      return Buffer.concat(chunks)
    } catch (error) {
      this.logger.debug(`附件 ${ref.key} 取不到:${String(error)}`)
      return "unavailable"
    }
  }
}
