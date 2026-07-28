import {
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from "@nestjs/common"
import sharp, { type Metadata } from "sharp"

/* F-7 影像處理(EXIF 剝除 / 縮圖 / 解壓縮炸彈防護)。

   **設計依據(docs/modules/foundation/image-processing.md)**
   - OQ-IP-4=C|主檔**優先無損切除 metadata 段**(像素位元組原封不動),僅當 EXIF orientation
     需正規化時才重新編碼 —— 重編碼是世代性失真,實測 q95 甚至讓檔案大 14%。
     此作法同時滿足 Airtable「does not modify the underlying file」的精神與消除 GPS
     (Partiful 2025-10 事故:未剝 GPS 遭 devtools 讀出街道級座標)。
   - OQ-IP-7=A|單一縮圖、長邊 320px、**永不放大**(承 Ragic:50×50 原圖之縮圖仍 50×50)。
   - OQ-IP-5=A|顯式 `limitInputPixels` —— 實測 sharp 預設 268MP **擋不住** 1.6MB/149.8MP 的檔案
     (解成 raw RGB 約 450MB);20MB 上傳上限完全不約束解碼期記憶體。

   **⚠️ 絕不呼叫 `withMetadata()` / `keepExif()` / `keepMetadata()`** —— 那會把 GPS 放回去。 */

const MAX_INPUT_PIXELS = 50_000_000
const THUMB_MAX_EDGE = 320
const THUMB_QUALITY = 78
/* 方向正規化需重編碼時的品質:實測 q90 之檔案大小與原始 q92 相當(−8%) */
const REENCODE_QUALITY = 90

/* 可處理的影像 MIME(HEIC 不在:預建 libvips 無 HEVC 解碼器,且雲端服務落在 HEVC 專利池收費範圍)*/
const PROCESSABLE = new Set(["image/jpeg", "image/png", "image/webp"])

export interface ProcessedImage {
  /* 主檔(已剝除 metadata);非影像或不可處理時為原 buffer */
  readonly body: Buffer
  /* 縮圖;無法產生時 undefined —— 前端退回原圖(OQ-IP-9=A,不建重生工具)*/
  readonly thumbnail?: Buffer
  /* 主檔是否經重新編碼(僅方向需正規化時);供測試與觀測 */
  readonly reEncoded: boolean
}

/* JPEG marker 層無損切除 APP1(EXIF)/ APP13(IPTC):只動段結構,不碰壓縮資料。
   回傳 null = 非 JPEG 或結構不符預期(則退回重編碼路徑)。 */
export function stripJpegMetadata(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  const parts: Buffer[] = [buf.subarray(0, 2)]
  let i = 2
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) return null // 結構不符 → 不冒險
    const marker = buf[i + 1] ?? 0
    if (marker === 0xda) {
      parts.push(buf.subarray(i)) // SOS 之後為壓縮資料,原樣保留
      return Buffer.concat(parts)
    }
    const length = buf.readUInt16BE(i + 2)
    if (length < 2) return null
    if (marker !== 0xe1 && marker !== 0xed) parts.push(buf.subarray(i, i + 2 + length))
    i += 2 + length
  }
  return null // 未見 SOS
}

@Injectable()
export class ImageProcessor {
  private readonly logger = new Logger(ImageProcessor.name)

  /* 非影像 → 原樣回傳(不改 attachment 之一般檔案)。 */
  async process(body: Buffer, mime: string): Promise<ProcessedImage> {
    if (!PROCESSABLE.has(mime)) return { body, reEncoded: false }

    let meta: Metadata
    try {
      meta = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    } catch (error) {
      // 尺寸超限之訊息要明確,不讓使用者看到 500
      if (String(error).includes("pixel limit")) {
        throw new PayloadTooLargeException({
          code: "IMAGE_TOO_LARGE",
          message: `影像尺寸超過上限(${MAX_INPUT_PIXELS / 1_000_000} 百萬像素)`,
        })
      }
      /* FMEA P5:magic bytes 過關但實際無法解碼(損毀 / 截斷 / 偽造)→ 明確 422,
       **不**原樣存入 —— 存了只會在稍後渲染時破圖,且無從得知何時壞的。 */
      throw new UnprocessableEntityException({
        code: "IMAGE_UNREADABLE",
        message: "影像檔無法解析(可能損毀或不完整)",
      })
    }

    const needsRotate = meta.orientation !== undefined && meta.orientation > 1
    const main = await this.mainFile(body, mime, needsRotate)
    const thumbnail = await this.thumbnail(body, meta)
    return thumbnail === undefined
      ? { body: main.body, reEncoded: main.reEncoded }
      : { body: main.body, thumbnail, reEncoded: main.reEncoded }
  }

  private async mainFile(
    body: Buffer,
    mime: string,
    needsRotate: boolean,
  ): Promise<{ body: Buffer; reEncoded: boolean }> {
    if (!needsRotate && mime === "image/jpeg") {
      const stripped = stripJpegMetadata(body)
      // 無損路徑:像素零改動(§0.4 已實測位元組相同)
      if (stripped !== null) return { body: stripped, reEncoded: false }
    }
    if (!needsRotate && mime !== "image/jpeg") {
      // PNG/WebP 之 metadata 罕含 GPS 且無無損切段實作 → 原樣保留(OQ-IP-4 殘留,doc 明列)
      return { body, reEncoded: false }
    }
    // 方向需正規化:.rotate() 把方向燒進像素,輸出預設不帶 metadata
    const pipeline = sharp(body, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
    const out =
      mime === "image/png"
        ? await pipeline.png().toBuffer()
        : mime === "image/webp"
          ? await pipeline.webp({ quality: REENCODE_QUALITY }).toBuffer()
          : await pipeline.jpeg({ quality: REENCODE_QUALITY }).toBuffer()
    return { body: out, reEncoded: true }
  }

  /* 縮圖一律 .rotate():Teable changelog 實證忽略 EXIF orientation 會讓 iPhone 照片縮圖轉向錯誤。
     失敗不阻斷上傳 —— 前端缺縮圖時退回原圖(OQ-IP-9=A)。 */
  private async thumbnail(body: Buffer, meta: Metadata): Promise<Buffer | undefined> {
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
    if (longest === 0) return undefined
    try {
      return await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer()
    } catch (error) {
      this.logger.warn(
        `thumbnail failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return undefined
    }
  }
}
