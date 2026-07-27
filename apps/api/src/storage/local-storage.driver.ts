import { createReadStream } from "node:fs"
import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { Readable } from "node:stream"
import { type StorageDriver, assertValidKey } from "./storage-driver.js"

/* F-5 local 檔案系統驅動(dev / on-prem Edge 自 host)。
   **根目錄必須在 webroot 外**(docs/22)—— 本專案不註冊 @fastify/static,無靜態服務面。
   key 已由伺服器生成且經 assertValidKey 驗形狀 → 無路徑穿越(FMEA S4);再以 resolve 前綴二次確認。 */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string

  constructor(rootDir: string) {
    this.root = resolve(rootDir)
  }

  private pathFor(key: string): string {
    assertValidKey(key)
    const full = resolve(join(this.root, key))
    if (!full.startsWith(`${this.root}/`)) throw new Error("storage key escapes root")
    return full
  }

  // meta 未用(檔案系統無 content-type 概念);簽章保持與介面一致
  async put(key: string, body: Buffer, _meta?: { mime: string }): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
  }

  get(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.pathFor(key)))
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const s = await stat(this.pathFor(key))
      return { size: s.size }
    } catch {
      return null
    }
  }
}
