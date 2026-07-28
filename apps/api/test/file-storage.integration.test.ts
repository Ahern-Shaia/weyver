import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigService } from "@nestjs/config"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { EffectivePermissions } from "../src/authz/authz-effective.js"
import type { FormAction } from "../src/authz/authz-model.js"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import type { FilesService } from "../src/files/files.service.js"

/* F-5 M2|上傳 / 下載 / 刪除端點 + file_object。
   覆蓋 FMEA S1(跨租戶 BOLA)· S2(hidden 欄拒下載)· S3(偽副檔名 / 型別白名單)· S4(key 形狀)。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let storageDir = ""
let filesService: FilesService
let tenantA = 0
let tenantB = 0
let formId = 0
let attachFieldId = 0
let textFieldId = 0

const savedEnv = { STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR }
const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })
const B = (): Record<string, string> => ({ "x-dev-tenant": String(tenantB), "x-dev-actor": "9" })

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
])

function multipart(filename: string, content: Buffer): { payload: Buffer; contentType: string } {
  const boundary = "----weyverboundary"
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

async function upload(
  headers: Record<string, string>,
  filename: string,
  content: Buffer,
  fieldId = attachFieldId,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const { payload, contentType } = multipart(filename, content)
  const res = await app.inject({
    method: "POST",
    url: `/api/forms/${formId}/files?fieldId=${fieldId}`,
    headers: { ...headers, "content-type": contentType },
    payload,
  })
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> }
}

/* 造非 admin 有效權限:表單動作集 + 欄位可見性(與 PermissionGuard 解析結果同型)。 */
function permsOf(
  actions: readonly FormAction[],
  fieldVis: ReadonlyMap<number, "hidden" | "read" | "write">,
): EffectivePermissions {
  return new EffectivePermissions(
    false,
    new Map([[formId, new Set(actions)]]),
    new Map(fieldVis),
    new Set(),
  )
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0

  storageDir = await mkdtemp(join(tmpdir(), "weyver-files-"))
  process.env.STORAGE_LOCAL_DIR = storageDir
  process.env.DATABASE_URL = uri
  process.env.APP_DATABASE_URL = uri

  const { AppModule } = await import("../src/app.module.js")
  const { configureApp } = await import("../src/app-setup.js")
  const { FilesService: FilesServiceClass } = await import("../src/files/files.service.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await configureApp(app) // multipart 於此註冊(與 main.ts 同構)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  filesService = app.get(FilesServiceClass)

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "進貨憑單",
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "證明文件", type: "attachment" },
      ],
    },
  })
  formId = (form.json() as { id: number }).id
  const detail = await app.inject({ method: "GET", url: `/api/forms/${formId}`, headers: A() })
  const fields = (detail.json() as { fields: { id: number; name: string }[] }).fields
  attachFieldId = fields.find((f) => f.name === "證明文件")?.id ?? 0
  textFieldId = fields.find((f) => f.name === "品名")?.id ?? 0
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
  await rm(storageDir, { recursive: true, force: true })
  Object.assign(process.env, savedEnv)
})

describe("F-5 M2 上傳", () => {
  it("PNG 上傳 → 201 + key 為伺服器生成(不含原檔名)", async () => {
    const { statusCode, body } = await upload(A(), "出貨照片.png", PNG)
    expect(statusCode).toBe(201)
    expect(body.mime).toBe("image/png")
    expect(body.name).toBe("出貨照片.png")
    expect(body.size).toBe(PNG.length)
    expect(String(body.key)).toMatch(new RegExp(`^t${tenantA}/f${formId}/[0-9a-f-]{36}\\.png$`))
    expect(String(body.key)).not.toContain("出貨照片")
  })

  it("FMEA S3:偽副檔名(內容為可執行)→ 415", async () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(32)])
    const { statusCode, body } = await upload(A(), "malware.png", elf)
    expect(statusCode).toBe(415)
    expect(body.code).toBe("UNSUPPORTED_FILE_TYPE")
  })

  it("非附件欄 → 400", async () => {
    const { statusCode, body } = await upload(A(), "a.png", PNG, textFieldId)
    expect(statusCode).toBe(400)
    expect(body.code).toBe("NOT_ATTACHMENT_FIELD")
  })

  it("空檔 → 400", async () => {
    const { statusCode, body } = await upload(A(), "empty.png", Buffer.alloc(0))
    expect(statusCode).toBe(400)
    expect(body.code).toBe("EMPTY_FILE")
  })

  it("非 multipart 請求 → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/files?fieldId=${attachFieldId}`,
      headers: A(),
      payload: { x: 1 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe("F-5 M2 下載 / 刪除", () => {
  it("下載 → attachment disposition + 保守 content-type + 內容一致", async () => {
    const { body } = await upload(A(), "簽收單.pdf", Buffer.from("%PDF-1.7\nhello"))
    const res = await app.inject({ method: "GET", url: `/api/files/${body.key}`, headers: A() })
    expect(res.statusCode).toBe(200)
    expect(res.headers["content-disposition"]).toContain("attachment")
    expect(res.headers["content-disposition"]).toContain(
      `filename*=UTF-8''${encodeURIComponent("簽收單.pdf")}`,
    )
    expect(res.headers["content-type"]).toBe("application/octet-stream")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
    expect(res.rawPayload.toString()).toBe("%PDF-1.7\nhello")
  })

  it("FMEA S1:B 租戶持 A 的 key 下載 → 404(key 非授權憑證)", async () => {
    const { body } = await upload(A(), "機密.pdf", Buffer.from("%PDF-1.7\nsecret"))
    const res = await app.inject({ method: "GET", url: `/api/files/${body.key}`, headers: B() })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { code: string }).code).toBe("FILE_NOT_FOUND")
  })

  it("FMEA S4:路徑穿越形狀的 key → 404(不觸及檔案系統)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/files/t1/f2/..%2F..%2Fetc%2Fpasswd",
      headers: A(),
    })
    expect(res.statusCode).toBe(404)
  })

  it("刪除 → 204,再下載 404(soft delete)", async () => {
    const { body } = await upload(A(), "待刪.png", PNG)
    const del = await app.inject({ method: "DELETE", url: `/api/files/${body.key}`, headers: A() })
    expect(del.statusCode).toBe(204)
    const res = await app.inject({ method: "GET", url: `/api/files/${body.key}`, headers: A() })
    expect(res.statusCode).toBe(404)
  })
})

describe("F-5 M3 兩階段綁定 / 孤兒 / 配額", () => {
  const statusOf = async (key: string): Promise<{ status: string; recordId: number | null }> => {
    const client = await pool.connect()
    try {
      // FORCE RLS 下需租戶 GUC 才讀得到(即使連線角色為 owner)
      await client.query("SELECT set_config('app.tenant_id', $1, false)", [String(tenantA)])
      const res = await client.query<{ status: string; record_id: string | null }>(
        "SELECT status, record_id FROM file_object WHERE key = $1",
        [key],
      )
      const row = res.rows[0]
      return {
        status: row?.status ?? "missing",
        recordId: row?.record_id == null ? null : Number(row.record_id),
      }
    } finally {
      client.release()
    }
  }

  it("上傳為 pending → 記錄存檔後轉 bound + 寫 record_id", async () => {
    const { body } = await upload(A(), "驗收單.pdf", Buffer.from("%PDF-1.7\nbind"))
    const key = String(body.key)
    expect((await statusOf(key)).status).toBe("pending")

    const created = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: { 品名: "冷凍雞胸", 證明文件: [{ key, name: "驗收單.pdf" }] } },
    })
    expect(created.statusCode).toBe(201)
    const recordId = (created.json() as { id: number }).id
    expect(await statusOf(key)).toEqual({ status: "bound", recordId })
  })

  it("更新記錄移除附件 → 原檔轉 orphaned;新附件轉 bound", async () => {
    const first = await upload(A(), "舊.pdf", Buffer.from("%PDF-1.7\nold"))
    const second = await upload(A(), "新.pdf", Buffer.from("%PDF-1.7\nnew"))
    const oldKey = String(first.body.key)
    const newKey = String(second.body.key)

    const created = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: { 品名: "換檔測試", 證明文件: [{ key: oldKey, name: "舊.pdf" }] } },
    })
    const record = created.json() as { id: number; version: number }
    expect((await statusOf(oldKey)).status).toBe("bound")

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${record.id}`,
      headers: A(),
      payload: {
        expectedVersion: record.version,
        values: { 證明文件: [{ key: newKey, name: "新.pdf" }] },
      },
    })
    expect(updated.statusCode).toBe(200)
    expect((await statusOf(oldKey)).status).toBe("orphaned")
    expect(await statusOf(newKey)).toEqual({ status: "bound", recordId: record.id })
  })

  it("逾期未綁之 pending → sweep 標 orphaned(且不再計入配額)", async () => {
    const { body } = await upload(A(), "遺留.pdf", Buffer.from("%PDF-1.7\nstale"))
    const key = String(body.key)
    await pool.query(
      "UPDATE file_object SET created_at = now() - interval '48 hours' WHERE key = $1",
      [key],
    )

    const before = await filesService.usedBytes(tenantA)
    const swept = await filesService.sweepStalePending(tenantA)
    expect(swept).toBeGreaterThanOrEqual(1)
    expect((await statusOf(key)).status).toBe("orphaned")
    expect(await filesService.usedBytes(tenantA)).toBeLessThan(before)
  })

  it("超過租戶配額 → 413 STORAGE_QUOTA_EXCEEDED", async () => {
    // 配額於開機由 validateEnv 定案 → 以 spy 壓低該鍵(其餘鍵委派原實作,不影響 guard 判 env)
    const config = app.get(ConfigService)
    const original = config.get.bind(config)
    const spy = vi
      .spyOn(config, "get")
      .mockImplementation(((key: string) =>
        key === "STORAGE_TENANT_QUOTA_MB" ? 0 : original(key)) as typeof config.get)
    try {
      const { statusCode, body } = await upload(A(), "超量.png", PNG)
      expect(statusCode).toBe(413)
      expect(body.code).toBe("STORAGE_QUOTA_EXCEEDED")
    } finally {
      spy.mockRestore()
    }
  })
})

describe("R1·UP-4b image / signature 欄型", () => {
  let imageFieldId = 0
  let signatureFieldId = 0
  let mediaFormId = 0

  const uploadTo = async (
    fieldId: number,
    filename: string,
    content: Buffer,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> => {
    const { payload, contentType } = multipart(filename, content)
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${mediaFormId}/files?fieldId=${fieldId}`,
      headers: { ...A(), "content-type": contentType },
      payload,
    })
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> }
  }

  beforeAll(async () => {
    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: "驗收拍照單",
        fields: [
          { name: "品名", type: "text", required: true },
          { name: "現場照片", type: "image" },
          { name: "簽收", type: "signature" },
        ],
      },
    })
    expect(form.statusCode).toBe(201)
    mediaFormId = (form.json() as { id: number }).id
    const detail = await app.inject({
      method: "GET",
      url: `/api/forms/${mediaFormId}`,
      headers: A(),
    })
    const list = (detail.json() as { fields: { id: number; name: string }[] }).fields
    imageFieldId = list.find((f) => f.name === "現場照片")?.id ?? 0
    signatureFieldId = list.find((f) => f.name === "簽收")?.id ?? 0
  })

  it("image / signature 欄可建立(jsonb,零 migration)", () => {
    expect(imageFieldId).toBeGreaterThan(0)
    expect(signatureFieldId).toBeGreaterThan(0)
  })

  it("影像可上傳至 image 欄", async () => {
    const { statusCode, body } = await uploadTo(imageFieldId, "現場.png", PNG)
    expect(statusCode).toBe(201)
    expect(body.mime).toBe("image/png")
  })

  it("FMEA S1:PDF 上傳到 image 欄 → 415(欄型收斂,非只靠全域白名單)", async () => {
    const { statusCode, body } = await uploadTo(
      imageFieldId,
      "規格書.pdf",
      Buffer.from("%PDF-1.7\nx"),
    )
    expect(statusCode).toBe(415)
    expect(String(body.message)).toContain("影像檔")
  })

  it("PDF 上傳到 attachment 欄仍可(收斂只針對影像欄)", async () => {
    const { statusCode } = await upload(A(), "一般附件.pdf", Buffer.from("%PDF-1.7\ny"))
    expect(statusCode).toBe(201)
  })

  it("簽名欄單張語意:存兩張 → 422", async () => {
    const first = await uploadTo(signatureFieldId, "sig1.png", PNG)
    const second = await uploadTo(signatureFieldId, "sig2.png", PNG)
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${mediaFormId}/records`,
      headers: A(),
      payload: {
        values: {
          品名: "雙簽",
          簽收: [
            { key: first.body.key, name: "sig1.png" },
            { key: second.body.key, name: "sig2.png" },
          ],
        },
      },
    })
    expect(res.statusCode).toBe(422)
  })

  it("簽名欄單張 → 存檔成功並綁定", async () => {
    const sig = await uploadTo(signatureFieldId, "簽名.png", PNG)
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${mediaFormId}/records`,
      headers: A(),
      payload: {
        values: { 品名: "單簽", 簽收: [{ key: sig.body.key, name: "簽名.png" }] },
      },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe("F-5 v1.1 P1 殘留補強", () => {
  it("FMEA S7:記錄 soft-delete 後,已綁附件不可再下載", async () => {
    const { body } = await upload(A(), "隨記錄.pdf", Buffer.from("%PDF-1.7\nrec"))
    const key = String(body.key)
    const created = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: { 品名: "隨記錄刪除", 證明文件: [{ key, name: "隨記錄.pdf" }] } },
    })
    const recordId = (created.json() as { id: number }).id

    const before = await app.inject({ method: "GET", url: `/api/files/${key}`, headers: A() })
    expect(before.statusCode).toBe(200)

    const del = await app.inject({
      method: "DELETE",
      url: `/api/forms/${formId}/records/${recordId}`,
      headers: A(),
    })
    expect(del.statusCode).toBe(204)

    const after = await app.inject({ method: "GET", url: `/api/files/${key}`, headers: A() })
    expect(after.statusCode).toBe(404)
  })

  it("未綁記錄之 pending 檔不受記錄狀態影響(填單中仍可預覽)", async () => {
    const { body } = await upload(A(), "填單中.pdf", Buffer.from("%PDF-1.7\ndraft"))
    const res = await app.inject({ method: "GET", url: `/api/files/${body.key}`, headers: A() })
    expect(res.statusCode).toBe(200)
  })
})

describe("F-5 M2 欄位級授權(非 admin;dev header 恆為 super admin 故直呼 service)", () => {
  it("FMEA S2:附件掛在 hidden 欄 → 拒下載", async () => {
    const { body } = await upload(A(), "薪資表.pdf", Buffer.from("%PDF-1.7\npay"))
    const key = String(body.key)
    const tenant = { tenantId: tenantA, actorId: 7 }

    const hidden = permsOf(["view"], new Map([[attachFieldId, "hidden"]]))
    await expect(filesService.openForDownload(tenant, hidden, key)).rejects.toMatchObject({
      status: 403,
    })

    const readable = permsOf(["view"], new Map([[attachFieldId, "read"]]))
    await expect(filesService.openForDownload(tenant, readable, key)).resolves.toBeDefined()
  })

  it("無表單 view 權 → 拒下載;無 edit 權 → 拒刪除", async () => {
    const { body } = await upload(A(), "報價.pdf", Buffer.from("%PDF-1.7\nquote"))
    const key = String(body.key)
    const tenant = { tenantId: tenantA, actorId: 7 }

    const none = permsOf([], new Map())
    await expect(filesService.openForDownload(tenant, none, key)).rejects.toMatchObject({
      status: 403,
    })
    const viewOnly = permsOf(["view"], new Map([[attachFieldId, "read"]]))
    await expect(filesService.remove(tenant, viewOnly, key)).rejects.toMatchObject({ status: 403 })
  })

  it("非 write 欄位可見性 → 拒上傳", async () => {
    const readOnly = permsOf(["view", "edit"], new Map([[attachFieldId, "read"]]))
    await expect(
      filesService.upload(
        { tenantId: tenantA, actorId: 7 },
        readOnly,
        formId,
        attachFieldId,
        "x.png",
        PNG,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })
})
