import type { Readable } from "node:stream"

/* F-5 儲存驅動抽象(OQ-FS-1=A)。實作:LocalStorageDriver(dev / on-prem)與
   S3StorageDriver(S3 相容 —— R2 / S3 / GCS / MinIO 同一驅動,避免 lock-in,docs/11 §16)。
   依 injection token 注入(AGENTS:依賴抽象 + token,不依賴具體類)。 */
export interface StorageDriver {
  put(key: string, body: Buffer, meta: { mime: string }): Promise<void>
  get(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  stat(key: string): Promise<{ size: number } | null>
  /* 🔴 F-11 M5|短效簽名 URL。**回 null 代表此驅動不支援**(本機檔案系統),
     呼叫端據此回退到伺服器代理 —— 不是錯誤,是能力差異。

     解的問題(file-storage §殘留):代理下載的瓶頸不是事件迴圈(`StreamableFile`
     是串流)而是**出口頻寬** —— Cloud Run 每實例並發 80 × 20MB 就塞滿。
     授權仍每次由 API 重新求值,只有位元組不經應用層。 */
  presign?(
    key: string,
    opts: { ttlSeconds: number; filename: string; mime: string },
  ): Promise<string | null>
}

export const STORAGE_DRIVER = Symbol("STORAGE_DRIVER")

/* key 格式(伺服器生成,不含使用者輸入):t{tenantId}/f{formId}/{uuid}{ext}
   —— 路徑穿越防護:任何不符此形狀者一律拒(FMEA S4)。 */
const KEY_RE = /^t\d+\/f\d+\/[0-9a-f-]{36}(\.thumb)?(\.[A-Za-z0-9]{1,8})?$/

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key)
}

/* F-7 縮圖為原檔之**衍生物**(OQ-IP-3=A):以固定後綴定址,零 migration。
   衍生 key 一律由伺服器生成,仍須通過 KEY_RE(已放寬容納 `.thumb` 後綴)。 */
export function thumbnailKeyOf(key: string): string {
  return `${key.replace(/\.[A-Za-z0-9]{1,8}$/, "")}.thumb.webp`
}

export function assertValidKey(key: string): void {
  if (!isValidKey(key)) throw new Error(`invalid storage key: ${key}`)
}
