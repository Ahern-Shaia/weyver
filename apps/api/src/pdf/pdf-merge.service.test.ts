import { Readable } from "node:stream"
import { ForbiddenException } from "@nestjs/common"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import type { FilesService } from "../files/files.service.js"
import { type AttachmentRef, PdfMergeService } from "./pdf-merge.service.js"

/* 🔴 R1·後續-2b M2 A3|附件合併。

   本檔用**真的 PDF 位元組**跑真的 `@cantoo/pdf-lib`,不 mock 合併本身 ——
   要驗的正是「頁真的接上去了」與「壞掉的附件不會讓整批倒」。
   被 mock 掉的只有檔案來源(`FilesService`),因為那一層的授權由
   `files` 自己的測試涵蓋,在這裡重測等於複製一份斷言。 */

let makePdf: (pages: number) => Promise<Buffer>
let pageCount: (bytes: Buffer) => Promise<number>

beforeAll(async () => {
  const { PDFDocument } = await import("@cantoo/pdf-lib")
  makePdf = async (pages: number): Promise<Buffer> => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i += 1) doc.addPage([200, 200])
    return Buffer.from(await doc.save())
  }
  pageCount = async (bytes: Buffer): Promise<number> =>
    (await PDFDocument.load(bytes)).getPageCount()
})

const perms = {} as EffectivePermissions

/* 每個 key 對映一份「檔案」。`mime` / `size` 刻意可覆寫 —— 上限與型別
   的判斷讀的就是這兩個欄位。 */
function serviceWith(
  files: Record<string, { body: Buffer; mime?: string; size?: number } | "forbidden">,
): PdfMergeService {
  const stub = {
    openForDownload: vi.fn(async (_ctx: unknown, _perms: unknown, key: string) => {
      const entry = files[key]
      if (entry === undefined || entry === "forbidden") {
        throw new ForbiddenException({ code: "FORBIDDEN", message: "no" })
      }
      return {
        stream: Readable.from([entry.body]),
        meta: {
          key,
          name: key,
          mime: entry.mime ?? "application/pdf",
          size: entry.size ?? entry.body.byteLength,
        },
      }
    }),
  }
  return new PdfMergeService(stub as unknown as FilesService)
}

const ref = (key: string): AttachmentRef => ({ key, name: `${key}.pdf` })

describe("PdfMergeService", () => {
  it("把附件的頁接在單據之後", async () => {
    const base = await makePdf(1)
    const svc = serviceWith({ a: { body: await makePdf(2) }, b: { body: await makePdf(3) } })
    const out = await svc.merge(1, 7, perms, base, [ref("a"), ref("b")])

    expect(await pageCount(out.pdf)).toBe(6)
    expect(out.skipped).toEqual([])
  })

  it("沒有附件時原樣回傳,不重新序列化", async () => {
    const base = await makePdf(1)
    const out = await serviceWith({}).merge(1, 7, perms, base, [])
    expect(out.pdf).toBe(base)
    expect(out.skipped).toEqual([])
  })

  it("🔴 非 PDF 的附件跳過並記原因 —— 不靜默", async () => {
    const svc = serviceWith({
      a: { body: Buffer.from("PKxlsx"), mime: "application/vnd.ms-excel" },
    })
    const out = await svc.merge(1, 7, perms, await makePdf(1), [ref("a")])

    expect(await pageCount(out.pdf)).toBe(1)
    expect(out.skipped).toEqual([{ name: "a.pdf", reason: "not-pdf" }])
  })

  it("🔴 壞掉的 PDF 不讓整批倒,其餘照併", async () => {
    const svc = serviceWith({
      bad: { body: Buffer.from("%PDF-1.4 這不是一份 PDF") },
      good: { body: await makePdf(2) },
    })
    const out = await svc.merge(1, 7, perms, await makePdf(1), [ref("bad"), ref("good")])

    expect(await pageCount(out.pdf)).toBe(3)
    expect(out.skipped).toEqual([{ name: "bad.pdf", reason: "unreadable" }])
  })

  it("🔴 加密的 PDF 與壞掉的 PDF 分開報 —— 前者使用者自己解得開", async () => {
    const { PDFDocument } = await import("@cantoo/pdf-lib")
    const locked = await PDFDocument.create()
    locked.addPage([200, 200])
    locked.encrypt({ userPassword: "s3cret", ownerPassword: "s3cret" })
    const svc = serviceWith({ a: { body: Buffer.from(await locked.save()) } })
    const out = await svc.merge(1, 7, perms, await makePdf(1), [ref("a")])

    expect(out.skipped).toEqual([{ name: "a.pdf", reason: "encrypted" }])
  })

  it("🔴 取不到的附件記 unavailable,而且不透露是哪一層擋的", async () => {
    const svc = serviceWith({ a: "forbidden" })
    const out = await svc.merge(1, 7, perms, await makePdf(1), [ref("a")])

    expect(out.skipped).toEqual([{ name: "a.pdf", reason: "unavailable" }])
  })

  it("🔴 metadata 的 size 說謊時,以實際讀到的位元組再擋一次", async () => {
    /* F-5 已經為「size 欄記的是配額佔用而非物件大小」踩過一次。
       只信 metadata 的話,上限形同虛設。 */
    const huge = Buffer.alloc(21 * 1024 * 1024, 0x41)
    const svc = serviceWith({ a: { body: huge, size: 1024 } })
    const out = await svc.merge(1, 7, perms, await makePdf(1), [ref("a")])

    expect(out.skipped).toEqual([{ name: "a.pdf", reason: "too-large" }])
  })

  it("metadata 就報超大時直接跳過,不必把它讀進記憶體", async () => {
    const svc = serviceWith({ a: { body: await makePdf(1), size: 999 * 1024 * 1024 } })
    const out = await svc.merge(1, 7, perms, await makePdf(1), [ref("a")])

    expect(out.skipped).toEqual([{ name: "a.pdf", reason: "too-large" }])
  })
})
