import type { Readable } from "node:stream"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
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
}
