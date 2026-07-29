import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { EffectivePermissions } from "../src/authz/authz-effective.js"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { listQuerySchema } from "../src/form-engine/records/record-specs.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 F-1 分組(docs/modules/R1/views-group-kanban-calendar.md)。

   **核心設計**|分組不是聚合查詢,是**排序的變形** —— group key 前置進 ORDER BY,
   keyset 完整保留。AG Grid 官方明載 infinite row model 不支援 grouping,
   前提是把分組理解成「先聚合再展開」;改成排序變形即無此限制。

   **最重要的測試是 G1**|群組小計必須與列表跑在同一 RLS role ——
   否則使用者只看得到 3 筆卻會看到「共 47 筆」,等於洩漏他無權存取之資料的存在與數量。
   Ragic 官方自承「報表快照以系統管理員權限產生,可能包含檢視者無權存取的資料」即此形狀。 */

const ALICE = 101
const BOB = 202

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
/* 記錄讀寫走 **app 角色**車道 —— superuser 一律 bypass RLS,用它測聚合洩漏等於什麼都沒測
   (本 session 已三度踩到「特權連線遮蔽權限」)。 */
let records: RecordService
const destroyers: (() => Promise<void>)[] = []
let tenantA = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db.insert(tenants).values([{ name: "廠 A" }]).returning()
  tenantA = rows[0]?.id ?? 0
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  destroyers.push(() => ddlKnex.destroy())
  ddl = new DdlService(ddlKnex, db, metadata)

  const uri = new URL(container.getConnectionUri())
  uri.username = "app_login"
  uri.password = "app_login"
  const appKnex = createDdlKnex(uri.toString())
  destroyers.push(() => appKnex.destroy())
  records = new RecordService(appKnex, metadata)
}, 120_000)

afterAll(async () => {
  for (const d of destroyers) await d()
  await pool.end()
  await container.stop()
})

async function orderForm(name: string): Promise<{ formId: number; statusFieldId: number }> {
  const created = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name,
      fields: [
        { name: "客戶", type: "text" },
        { name: "狀態", type: "singleSelect", options: { choices: ["新單", "處理中", "已完成"] } },
        { name: "金額", type: "money" },
        { name: "下單日", type: "date" },
      ],
    }),
    ALICE,
  )
  return {
    formId: created.form.id,
    statusFieldId: created.fields.find((f) => f.name === "狀態")?.id ?? 0,
  }
}

const query = (over: Record<string, unknown> = {}) =>
  listQuerySchema.parse({ filters: [], sort: [], limit: 50, ...over })

const allPerms = (formId: number): EffectivePermissions =>
  new EffectivePermissions(
    false,
    new Map([[formId, new Set(["view", "edit"] as const)]]),
    new Map(),
    new Set(),
  )

describe("F-1 分組:排序變形 + keyset 保留", () => {
  it("**分組鍵前置於排序鍵** —— 同組的記錄連續出現,不交錯", async () => {
    const { formId } = await orderForm(`分組排序_${String(Date.now()).slice(-6)}`)
    for (const [c, s] of [
      ["甲", "已完成"],
      ["乙", "新單"],
      ["丙", "已完成"],
      ["丁", "新單"],
      ["戊", "處理中"],
    ]) {
      await records.createRecord(tenantA, formId, { 客戶: c, 狀態: s }, ALICE)
    }
    const page = await records.listRecords(
      tenantA,
      formId,
      query({ groupBy: [{ field: "狀態", dir: "asc" }] }),
    )
    const statuses = page.records.map((r) => String(r.values.狀態))
    // 同一狀態必須連續 —— 檢查沒有「離開後又回來」的狀態
    const seen = new Set<string>()
    let prev = ""
    for (const s of statuses) {
      if (s !== prev) {
        expect(seen.has(s)).toBe(false)
        seen.add(s)
        prev = s
      }
    }
    expect(seen.size).toBe(3)
  })

  it("**keyset 續頁不跨組錯位** —— 分頁後全部記錄仍恰好出現一次", async () => {
    const { formId } = await orderForm(`分組續頁_${String(Date.now()).slice(-6)}`)
    const states = ["新單", "處理中", "已完成"]
    for (let i = 0; i < 12; i++) {
      await records.createRecord(
        tenantA,
        formId,
        { 客戶: `客${String(i)}`, 狀態: states[i % 3] },
        ALICE,
      )
    }
    const collected: string[] = []
    let cursor: string | undefined
    for (let guard = 0; guard < 10; guard++) {
      const page = await records.listRecords(
        tenantA,
        formId,
        query({ limit: 5, groupBy: [{ field: "狀態", dir: "asc" }], ...(cursor ? { cursor } : {}) }),
      )
      collected.push(...page.records.map((r) => String(r.values.客戶)))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    expect(collected).toHaveLength(12)
    expect(new Set(collected).size).toBe(12) // 無重複
  })

  it("空值自成一組且不被切成兩段(NULLS LAST 與群排序一致)", async () => {
    const { formId } = await orderForm(`空值分組_${String(Date.now()).slice(-6)}`)
    for (const [c, s] of [["甲", "新單"], ["乙", null], ["丙", "新單"], ["丁", null]] as const) {
      await records.createRecord(
        tenantA,
        formId,
        s === null ? { 客戶: c } : { 客戶: c, 狀態: s },
        ALICE,
      )
    }
    const page = await records.listRecords(
      tenantA,
      formId,
      query({ groupBy: [{ field: "狀態", dir: "asc" }] }),
    )
    const nullPositions = page.records
      .map((r, i) => (r.values.狀態 === null ? i : -1))
      .filter((i) => i >= 0)
    // 空值群必須連續(NULLS LAST → 在最尾)
    expect(nullPositions).toEqual([2, 3])
  })
})

describe("F-1 群組統計", () => {
  it("每組筆數與加總由 DB 算(不是對已載入頁加總)", async () => {
    const { formId } = await orderForm(`群組統計_${String(Date.now()).slice(-6)}`)
    for (const [s, amt] of [
      ["新單", "100.0000"],
      ["新單", "200.0000"],
      ["已完成", "50.0000"],
    ] as const) {
      await records.createRecord(tenantA, formId, { 狀態: s, 金額: amt }, ALICE)
    }
    const stats = await records.groupStats(
      tenantA,
      formId,
      query({ groupBy: [{ field: "狀態", dir: "asc" }] }),
      [{ field: "金額", fn: "sum" }],
      allPerms(formId),
      ALICE,
    )
    const bucket = (k: string) => stats.groups.find((g) => g.keys[0] === k)
    expect(bucket("新單")?.count).toBe(2)
    expect(Number(bucket("新單")?.aggregates["sum:金額"])).toBe(300)
    expect(bucket("已完成")?.count).toBe(1)
  })

  it("**小計不受 page size 影響** —— 頁大小改變不會改變數字(§0.2 的教訓)", async () => {
    const { formId } = await orderForm(`頁大小_${String(Date.now()).slice(-6)}`)
    for (let i = 0; i < 7; i++) {
      await records.createRecord(tenantA, formId, { 狀態: "新單" }, ALICE)
    }
    const a = await records.groupStats(
      tenantA,
      formId,
      query({ limit: 2, groupBy: [{ field: "狀態", dir: "asc" }] }),
      [],
      allPerms(formId),
      ALICE,
    )
    const b = await records.groupStats(
      tenantA,
      formId,
      query({ limit: 50, groupBy: [{ field: "狀態", dir: "asc" }] }),
      [],
      allPerms(formId),
      ALICE,
    )
    expect(a.groups[0]?.count).toBe(7)
    expect(b.groups[0]?.count).toBe(7)
  })

  it("篩選條件同時作用於列表與小計(母體一致)", async () => {
    const { formId } = await orderForm(`母體一致_${String(Date.now()).slice(-6)}`)
    for (const c of ["甲", "甲", "乙"]) {
      await records.createRecord(tenantA, formId, { 客戶: c, 狀態: "新單" }, ALICE)
    }
    const q = query({
      filters: [{ field: "客戶", op: "eq", value: "甲" }],
      groupBy: [{ field: "狀態", dir: "asc" }],
    })
    const list = await records.listRecords(tenantA, formId, q, allPerms(formId), ALICE)
    const stats = await records.groupStats(tenantA, formId, q, [], allPerms(formId), ALICE)
    expect(list.records).toHaveLength(2)
    expect(stats.groups[0]?.count).toBe(2)
  })
})

/* 🔴 FMEA G1 / G2:本模組最重要的兩條防線 */
describe("🔴 分組不得成為越權讀取的側門", () => {
  const scopedToOwn = (formId: number): EffectivePermissions =>
    new EffectivePermissions(
      false,
      new Map([[formId, new Set(["view"] as const)]]),
      new Map(),
      new Set(),
      new Map([[formId, new Set(["view"] as const)]]),
    )

  it("**G1:記錄範圍為 own 時,群組計數只算得到自己看得到的**(Ragic 快照式洩漏)", async () => {
    const { formId } = await orderForm(`計數洩漏_${String(Date.now()).slice(-6)}`)
    for (let i = 0; i < 7; i++) {
      await records.createRecord(tenantA, formId, { 狀態: "新單" }, ALICE)
    }
    for (let i = 0; i < 3; i++) {
      await records.createRecord(tenantA, formId, { 狀態: "新單" }, BOB)
    }
    const stats = await records.groupStats(
      tenantA,
      formId,
      query({ groupBy: [{ field: "狀態", dir: "asc" }] }),
      [],
      scopedToOwn(formId),
      BOB,
    )
    // BOB 只建了 3 筆 —— 若回 10 就是洩漏了 ALICE 的 7 筆之存在
    expect(stats.groups[0]?.count).toBe(3)
  })

  it("**G2:隱藏欄不得作為分組鍵** —— group header 的值本身即是資料", async () => {
    const { formId, statusFieldId } = await orderForm(`隱藏分組_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 狀態: "新單" }, ALICE)
    const hidden = new EffectivePermissions(
      false,
      new Map([[formId, new Set(["view"] as const)]]),
      new Map([[statusFieldId, "hidden" as const]]),
      new Set(),
    )
    await expect(
      records.listRecords(
        tenantA,
        formId,
        query({ groupBy: [{ field: "狀態", dir: "asc" }] }),
        hidden,
        ALICE,
      ),
    ).rejects.toThrow()
  })

  it("**隱藏欄不得被聚合** —— 小計同樣會洩漏其分佈", async () => {
    const { formId, statusFieldId } = await orderForm(`隱藏聚合_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 客戶: "甲", 狀態: "新單" }, ALICE)
    const hidden = new EffectivePermissions(
      false,
      new Map([[formId, new Set(["view"] as const)]]),
      new Map([[statusFieldId, "hidden" as const]]),
      new Set(),
    )
    await expect(
      records.groupStats(
        tenantA,
        formId,
        query({ groupBy: [{ field: "客戶", dir: "asc" }] }),
        [{ field: "狀態", fn: "count" }],
        hidden,
        ALICE,
      ),
    ).rejects.toThrow()
  })
})

describe("F-1 折疊與日期粒度", () => {
  it("折疊的群組從查詢排除(而非前端隱藏 → 否則折疊後仍吃 page size)", async () => {
    const { formId } = await orderForm(`折疊_${String(Date.now()).slice(-6)}`)
    for (const s of ["新單", "新單", "已完成"]) {
      await records.createRecord(tenantA, formId, { 狀態: s }, ALICE)
    }
    const page = await records.listRecords(
      tenantA,
      formId,
      query({ groupBy: [{ field: "狀態", dir: "asc" }], collapsed: [["新單"]] }),
    )
    expect(page.records).toHaveLength(1)
    expect(page.records[0]?.values.狀態).toBe("已完成")
  })

  it("日期欄可依月分組(date 欄無時區,直接 truncate)", async () => {
    const { formId } = await orderForm(`日期分組_${String(Date.now()).slice(-6)}`)
    for (const d of ["2026-01-15", "2026-01-28", "2026-03-02"]) {
      await records.createRecord(tenantA, formId, { 下單日: d }, ALICE)
    }
    const stats = await records.groupStats(
      tenantA,
      formId,
      query({ groupBy: [{ field: "下單日", dir: "asc", unit: "month" }] }),
      [],
      allPerms(formId),
      ALICE,
    )
    expect(stats.groups).toHaveLength(2)
    expect(stats.groups[0]?.count).toBe(2)
    expect(stats.groups[1]?.count).toBe(1)
  })
})
