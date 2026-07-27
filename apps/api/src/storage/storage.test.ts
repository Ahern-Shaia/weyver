import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { detectType, extensionOf } from "./file-type.js"
import { LocalStorageDriver } from "./local-storage.driver.js"
import { isValidKey } from "./storage-driver.js"

/* F-5 M1 單元測:key 形狀(路徑穿越防護)、magic bytes 型別判定、local driver 往返。 */

describe("storage key 形狀(FMEA S4 路徑穿越)", () => {
  it("接受伺服器生成之 key", () => {
    expect(isValidKey("t1/f2/0f9e8d7c-6b5a-4938-8271-0a1b2c3d4e5f.png")).toBe(true)
    expect(isValidKey("t10/f200/0f9e8d7c-6b5a-4938-8271-0a1b2c3d4e5f")).toBe(true)
  })

  it("拒絕路徑穿越 / 任意路徑", () => {
    for (const bad of [
      "../etc/passwd",
      "t1/f2/../../etc/passwd",
      "/etc/passwd",
      "t1/f2/not-a-uuid.png",
      "tx/f2/0f9e8d7c-6b5a-4938-8271-0a1b2c3d4e5f",
      "t1/f2/0f9e8d7c-6b5a-4938-8271-0a1b2c3d4e5f.exe.sh",
    ]) {
      expect(isValidKey(bad)).toBe(false)
    }
  })
})

describe("magic bytes 型別判定(docs/22:非副檔名)", () => {
  it("PNG / JPEG / PDF 依內容判定", () => {
    expect(detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), "x.png")?.mime).toBe("image/png")
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "x.jpg")?.mime).toBe("image/jpeg")
    expect(detectType(Buffer.from("%PDF-1.7"), "x.pdf")?.mime).toBe("application/pdf")
  })

  it("偽副檔名不放行:內容為可執行/未知 → null", () => {
    // ELF header 偽裝成 .png
    expect(detectType(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "evil.png")).toBeNull()
    // 未知二進位偽裝成 .pdf
    expect(detectType(Buffer.from([0x00, 0x01, 0x02, 0x03]), "evil.pdf")).toBeNull()
  })

  it("zip 容器僅在宣告 OOXML 副檔名時放行(避免任意壓縮檔挾帶)", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])
    expect(detectType(zip, "a.xlsx")?.mime).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    expect(detectType(zip, "a.zip")).toBeNull()
  })

  it("純文字僅於 txt/csv 且無 NUL 時放行", () => {
    expect(detectType(Buffer.from("a,b,c\n1,2,3"), "x.csv")?.mime).toBe("text/csv")
    expect(detectType(Buffer.from([0x61, 0x00, 0x62]), "x.txt")).toBeNull()
  })

  it("extensionOf 取小寫副檔名", () => {
    expect(extensionOf("A.PNG")).toBe(".png")
    expect(extensionOf("noext")).toBe("")
  })
})

describe("LocalStorageDriver 往返", () => {
  let dir = ""
  let driver: LocalStorageDriver
  const key = "t1/f2/0f9e8d7c-6b5a-4938-8271-0a1b2c3d4e5f.png"

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "weyver-storage-"))
    driver = new LocalStorageDriver(dir)
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("put → stat → get → delete", async () => {
    const body = Buffer.from("hello-weyver")
    await driver.put(key, body, { mime: "image/png" })
    expect((await driver.stat(key))?.size).toBe(body.length)

    const stream = await driver.get(key)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe("hello-weyver")

    await driver.delete(key)
    expect(await driver.stat(key)).toBeNull()
  })

  it("非法 key 直接拋(不觸及檔案系統)", async () => {
    await expect(driver.put("../evil", Buffer.from("x"), { mime: "text/plain" })).rejects.toThrow()
  })
})
