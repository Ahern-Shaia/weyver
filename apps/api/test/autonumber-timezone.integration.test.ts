import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type pg from "pg"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

/* 🔴 追溯稽核 #105 P1-7|autoNumber 的日期分界原本走 UTC。
   台灣 UTC+8:1/1 08:00 之前開的單,UTC 還在去年 →
   (a) 單號日期段印成去年、(b) yearly 歸零續用去年的桶。
   憑證列印出去就收不回來,故以租戶時區判定分界。 */

const ACTOR = 1
/* 2025-12-31 23:30Z == 2026-01-01 07:30 台北 —— 跨年分界兩側 */
const CROSS_YEAR = new Date("2025-12-31T23:30:00Z")

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let knexDestroy: () => Promise<void>
let taipei = 0
let utcTenant = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = testPool(container.getConnectionUri(), 8)
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "台北廠" }, { name: "UTC 廠", timezone: "UTC" }])
    .returning()
  taipei = rows[0]?.id ?? 0
  utcTenant = rows[1]?.id ?? 0
  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)
}, 120_000)

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

async function numberedForm(tenantId: number, name: string): Promise<number> {
  const { form } = await ddl.createForm(
    tenantId,
    createFormSpecSchema.parse({
      name,
      fields: [
        {
          name: "單號",
          type: "autoNumber",
          options: { prefix: "SO-", dateFormat: "yyyy", resetScope: "yearly", width: 3 },
        },
      ],
    }),
    ACTOR,
  )
  return form.id
}

describe("🔴 autoNumber 日期分界走租戶時區(追溯稽核 #105)", () => {
  it("**台北租戶在 1/1 07:30 開單要拿到 2026 的號** —— 原本走 UTC 會印成 2025", async () => {
    const formId = await numberedForm(taipei, "台北訂單")
    vi.useFakeTimers()
    vi.setSystemTime(CROSS_YEAR)

    const created = await records.createRecord(taipei, formId, {}, ACTOR)
    expect(created.values.單號).toBe("SO-2026001")
  })

  it("同一時刻,UTC 租戶仍應是 2025 —— 分界確實依租戶而非寫死", async () => {
    const formId = await numberedForm(utcTenant, "UTC 訂單")
    vi.useFakeTimers()
    vi.setSystemTime(CROSS_YEAR)

    const created = await records.createRecord(utcTenant, formId, {}, ACTOR)
    expect(created.values.單號).toBe("SO-2025001")
  })

  it("跨年後序號歸零 —— 年度桶依租戶時區切,不會續用去年的號", async () => {
    const formId = await numberedForm(taipei, "跨年訂單")

    vi.useFakeTimers()
    // 台北 2025-12-31 20:00(UTC 12:00)—— 仍在 2025
    vi.setSystemTime(new Date("2025-12-31T12:00:00Z"))
    const last2025 = await records.createRecord(taipei, formId, {}, ACTOR)
    expect(last2025.values.單號).toBe("SO-2025001")

    // 台北 2026-01-01 07:30(UTC 前一日 23:30)—— 已跨年,序號應歸零
    vi.setSystemTime(CROSS_YEAR)
    const first2026 = await records.createRecord(taipei, formId, {}, ACTOR)
    expect(first2026.values.單號).toBe("SO-2026001")
  })
})
