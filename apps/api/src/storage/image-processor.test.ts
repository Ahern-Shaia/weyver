import sharp from "sharp"
import { beforeAll, describe, expect, it } from "vitest"
import { ImageProcessor, stripJpegMetadata } from "./image-processor.js"
import { thumbnailKeyOf } from "./storage-driver.js"

/* F-7 影像處理單元測。重點:EXIF 確實消失、無損路徑像素不動、方向正規化、炸彈防護、永不放大。 */

const processor = new ImageProcessor()
let photo: Buffer // 帶 EXIF 的 JPEG

beforeAll(async () => {
  const base = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#357" } })
    .jpeg({ quality: 90 })
    .toBuffer()
  photo = await sharp(base)
    /* sharp 的 Exif 型別未列 GPS(libvips 執行期接受);測試刻意寫入 GPS 以證明它會被剝除 */
    .withExif({ IFD0: { Make: "Apple", Model: "iPhone" }, GPS: { GPSLatitudeRef: "N" } } as never)
    .toBuffer()
})

describe("stripJpegMetadata(無損切段)", () => {
  it("移除 EXIF 且**壓縮資料位元組不變**", async () => {
    expect((await sharp(photo).metadata()).exif).toBeDefined()
    const stripped = stripJpegMetadata(photo)
    expect(stripped).not.toBeNull()
    expect((await sharp(stripped as Buffer).metadata()).exif).toBeUndefined()
    // SOS 之後的壓縮資料應原封不動
    expect((stripped as Buffer).subarray(-3000).equals(photo.subarray(-3000))).toBe(true)
  })

  it("非 JPEG → null(交由重編碼路徑處理)", () => {
    expect(stripJpegMetadata(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBeNull()
    expect(stripJpegMetadata(Buffer.alloc(2))).toBeNull()
  })
})

describe("ImageProcessor.process", () => {
  it("FMEA P2:JPEG 主檔剝除 EXIF 且**不重新編碼**(無損路徑)", async () => {
    const out = await processor.process(photo, "image/jpeg")
    expect(out.reEncoded).toBe(false)
    expect((await sharp(out.body).metadata()).exif).toBeUndefined()
  })

  it("產生縮圖:webp、長邊 ≤ 320", async () => {
    const out = await processor.process(photo, "image/jpeg")
    expect(out.thumbnail).toBeDefined()
    const meta = await sharp(out.thumbnail as Buffer).metadata()
    expect(meta.format).toBe("webp")
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(320)
  })

  it("**永不放大**(承 Ragic):小於縮圖尺寸之原圖,縮圖維持原尺寸", async () => {
    const small = await sharp({
      create: { width: 50, height: 50, channels: 3, background: "#0a0" },
    })
      .jpeg()
      .toBuffer()
    const out = await processor.process(small, "image/jpeg")
    const meta = await sharp(out.thumbnail as Buffer).metadata()
    expect(meta.width).toBe(50)
    expect(meta.height).toBe(50)
  })

  it("FMEA P3:EXIF orientation 需正規化 → 重新編碼且方向燒進像素", async () => {
    const rotated = await sharp(photo)
      .withExif({ IFD0: { Orientation: "6" } })
      .toBuffer()
    const before = await sharp(rotated).metadata()
    const out = await processor.process(rotated, "image/jpeg")
    if (before.orientation !== undefined && before.orientation > 1) {
      expect(out.reEncoded).toBe(true)
      const after = await sharp(out.body).metadata()
      expect(after.orientation).toBeUndefined() // 標籤已移除
      expect(after.width).toBe(before.height) // 尺寸互換 = 方向已燒進像素
    }
  })

  it("FMEA P1:超過像素上限 → 413 明確訊息(非 500)", async () => {
    // 8000×8000 = 64 MP > 50 MP 上限;檔案本身很小(解壓縮炸彈的形狀)
    const bomb = await sharp({
      create: { width: 8000, height: 8000, channels: 3, background: "#111" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer()
    await expect(processor.process(bomb, "image/png")).rejects.toMatchObject({ status: 413 })
  })

  it("非影像檔原樣通過(不動一般附件)", async () => {
    const pdf = Buffer.from("%PDF-1.7\nhello")
    const out = await processor.process(pdf, "application/pdf")
    expect(out.body.equals(pdf)).toBe(true)
    expect(out.thumbnail).toBeUndefined()
  })
})

describe("thumbnailKeyOf", () => {
  it("以固定後綴衍生,且仍符合 key 形狀白名單", () => {
    const key = "t1/f2/0f9e8d7c-6b5a-4938-8271-0a1b2c3d4e5f.jpg"
    expect(thumbnailKeyOf(key)).toBe("t1/f2/0f9e8d7c-6b5a-4938-8271-0a1b2c3d4e5f.thumb.webp")
  })
})
