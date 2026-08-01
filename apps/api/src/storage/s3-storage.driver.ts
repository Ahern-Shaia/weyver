import type { Readable } from "node:stream"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { type StorageDriver, assertValidKey } from "./storage-driver.js"

/* F-5 S3 相容驅動(OQ-FS-1=A)。同一實作涵蓋 **Cloudflare R2 / AWS S3 / GCS 相容模式 / MinIO**
   —— 僅以 endpoint + credentials 區分,無 vendor lock-in(docs/11 §3.6 選 R2、§16 明示避 lock-in)。 */
export interface S3DriverConfig {
  readonly bucket: string
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly endpoint?: string | undefined
}

export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: S3DriverConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // R2 / MinIO 需自訂 endpoint + path-style;AWS S3 留空即用預設
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint, forcePathStyle: true }),
    })
  }

  async put(key: string, body: Buffer, meta: { mime: string }): Promise<void> {
    assertValidKey(key)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: meta.mime,
      }),
    )
  }

  async get(key: string): Promise<Readable> {
    assertValidKey(key)
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    const body = res.Body
    if (body === undefined) throw new Error(`storage object not found: ${key}`)
    return body as Readable
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async stat(key: string): Promise<{ size: number } | null> {
    assertValidKey(key)
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return { size: res.ContentLength ?? 0 }
    } catch {
      return null
    }
  }

  /* 🔴 F-11 M5|短效簽名 URL(30–60 秒)。

     **授權不在這裡** —— 呼叫端已經做完權限與掃描狀態的判定,這裡只負責簽。
     TTL 短到即使 URL 外流也幾乎沒有可用窗口;每次下載都要重新向 API 取,
     所以權限被收回時下一次就拿不到。

     簽章帶 `response-content-disposition` 與 `response-content-type` 覆寫,
     讓 header 仍受我們控制 —— 否則 polyglot / SVG 這類檔案會以物件儲存
     宣告的型別被瀏覽器直接開啟,繞過我們一路守著的 attachment + nosniff。 */
  async presign(
    key: string,
    opts: { ttlSeconds: number; filename: string; mime: string },
  ): Promise<string | null> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: opts.mime,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
    })
    return getSignedUrl(this.client, command, { expiresIn: opts.ttlSeconds })
  }
}
