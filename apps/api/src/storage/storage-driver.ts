import type { Readable } from "node:stream"

/* F-5 儲存驅動抽象(OQ-FS-1=A)。實作:LocalStorageDriver(dev / on-prem)與
   S3StorageDriver(S3 相容 —— R2 / S3 / GCS / MinIO 同一驅動,避免 lock-in,docs/11 §16)。
   依 injection token 注入(AGENTS:依賴抽象 + token,不依賴具體類)。 */
export interface StorageDriver {
  put(key: string, body: Buffer, meta: { mime: string }): Promise<void>
  get(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  stat(key: string): Promise<{ size: number } | null>
}

export const STORAGE_DRIVER = Symbol("STORAGE_DRIVER")

/* key 格式(伺服器生成,不含使用者輸入):t{tenantId}/f{formId}/{uuid}{ext}
   —— 路徑穿越防護:任何不符此形狀者一律拒(FMEA S4)。 */
const KEY_RE = /^t\d+\/f\d+\/[0-9a-f-]{36}(\.[A-Za-z0-9]{1,8})?$/

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key)
}

export function assertValidKey(key: string): void {
  if (!isValidKey(key)) throw new Error(`invalid storage key: ${key}`)
}
