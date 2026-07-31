import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
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
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
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

/* 🔴 F-1 M4 行事曆:區間重疊查詢。
   **與 group-by 不同** —— 一筆記錄可橫跨多天(佔多格),group-by 假設一筆屬一組。
   時區以 RFC 5545 為錨:全天事件無時區(floating)、DTEND 排他。 */
describe("F-1 行事曆區間查詢", () => {
  async function leaveForm(name: string): Promise<number> {
    const created = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name,
        fields: [
          { name: "事由", type: "text" },
          { name: "開始", type: "date" },
          { name: "結束", type: "date" },
          { name: "時點", type: "dateTime" },
        ],
      }),
      ALICE,
    )
    return created.form.id
  }

  it("**跨月事件在兩個月都查得到**(一筆佔多格,group-by 做不到)", async () => {
    const formId = await leaveForm(`跨月_${String(Date.now()).slice(-6)}`)
    await records.createRecord(
      tenantA,
      formId,
      { 事由: "長假", 開始: "2026-01-28", 結束: "2026-02-03" },
      ALICE,
    )
    const jan = await records.calendarRange(tenantA, formId, {
      startField: "開始",
      endField: "結束",
      from: "2026-01-01",
      to: "2026-02-01",
      filters: [],
      limit: 100,
    })
    const feb = await records.calendarRange(tenantA, formId, {
      startField: "開始",
      endField: "結束",
      from: "2026-02-01",
      to: "2026-03-01",
      filters: [],
      limit: 100,
    })
    expect(jan.records).toHaveLength(1)
    expect(feb.records).toHaveLength(1)
  })

  it("**to 為排他** —— 落在 to 當天的事件不算在範圍內(RFC 5545 DTEND 語意)", async () => {
    const formId = await leaveForm(`排他_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 事由: "邊界", 開始: "2026-02-01" }, ALICE)
    const jan = await records.calendarRange(tenantA, formId, {
      startField: "開始",
      from: "2026-01-01",
      to: "2026-02-01",
      filters: [],
      limit: 100,
    })
    expect(jan.records).toHaveLength(0)
  })

  it("無結束欄時視為單日事件", async () => {
    const formId = await leaveForm(`單日_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 事由: "會議", 開始: "2026-02-10" }, ALICE)
    const inRange = await records.calendarRange(tenantA, formId, {
      startField: "開始",
      from: "2026-02-10",
      to: "2026-02-11",
      filters: [],
      limit: 100,
    })
    const outRange = await records.calendarRange(tenantA, formId, {
      startField: "開始",
      from: "2026-02-11",
      to: "2026-02-12",
      filters: [],
      limit: 100,
    })
    expect(inRange.records).toHaveLength(1)
    expect(outRange.records).toHaveLength(0)
  })

  it("🔴 dateTime 依租戶時區判定日期(UTC+8 邊界,否則會差一天)", async () => {
    const formId = await leaveForm(`時區_${String(Date.now()).slice(-6)}`)
    /* 2026-02-10T23:00Z = 台北時間 2026-02-11 07:00
       依 UTC 判定會落在 2/10、依租戶時區(Asia/Taipei)應落在 2/11。
       Airtable 依瀏覽器時區導致的「差一天」正是這個形狀。 */
    await records.createRecord(
      tenantA,
      formId,
      { 事由: "跨時區", 時點: "2026-02-10T23:00:00.000Z" },
      ALICE,
    )
    const feb11 = await records.calendarRange(tenantA, formId, {
      startField: "時點",
      from: "2026-02-11",
      to: "2026-02-12",
      filters: [],
      limit: 100,
    })
    expect(feb11.records).toHaveLength(1)
  })

  it("非日期欄不得作為行事曆欄位", async () => {
    const formId = await leaveForm(`非日期_${String(Date.now()).slice(-6)}`)
    await expect(
      records.calendarRange(tenantA, formId, {
        startField: "事由",
        from: "2026-02-01",
        to: "2026-03-01",
        filters: [],
        limit: 100,
      }),
    ).rejects.toThrow()
  })

  it("超過上限時明示截斷(不靜默丟棄)", async () => {
    const formId = await leaveForm(`截斷_${String(Date.now()).slice(-6)}`)
    for (let i = 0; i < 4; i++) {
      await records.createRecord(tenantA, formId, { 事由: `E${String(i)}`, 開始: "2026-02-05" }, ALICE)
    }
    const res = await records.calendarRange(tenantA, formId, {
      startField: "開始",
      from: "2026-02-01",
      to: "2026-03-01",
      filters: [],
      limit: 2,
    })
    expect(res.records).toHaveLength(2)
    expect(res.truncated).toBe(true)
  })
})

/* 🔴 F-2 樞紐分析。引擎與 group-stats 共用,差別只在 grouping set 的產生規則:
   前綴 rollup → **兩組前綴的笛卡兒積**(Metabase 的 breakout-combination 定義)。

   最重要的兩條是 P1(欄標頭洩漏)與 P4(date_trunc 表達式被 planner 拒絕)。 */
describe("F-2 樞紐分析", () => {
  async function salesForm(name: string): Promise<{ formId: number; statusFieldId: number }> {
    const created = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name,
        fields: [
          { name: "區域", type: "singleSelect", options: { choices: ["北", "中", "南"] } },
          { name: "狀態", type: "singleSelect", options: { choices: ["新單", "已完成"] } },
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

  const pivotQ = (over: Record<string, unknown>) => ({
    rowGroupBy: [{ field: "區域", dir: "asc" as const }],
    colGroupBy: [],
    aggregates: [],
    filters: [],
    ...over,
  })

  it("**雙軸交叉:列軸 × 欄軸各自成格,且有兩軸的小計層**", async () => {
    const { formId } = await salesForm(`雙軸_${String(Date.now()).slice(-6)}`)
    for (const [r, c] of [
      ["北", "新單"],
      ["北", "新單"],
      ["北", "已完成"],
      ["南", "已完成"],
    ] as const) {
      await records.createRecord(tenantA, formId, { 區域: r, 狀態: c }, ALICE)
    }
    const res = await records.pivot(
      tenantA,
      formId,
      pivotQ({ colGroupBy: [{ field: "狀態", dir: "asc" }] }),
      allPerms(formId),
      ALICE,
    )
    const cell = (r: string, c: string) =>
      res.cells.find((x) => x.rowKeys[0] === r && x.colKeys[0] === c)
    expect(cell("北", "新單")?.count).toBe(2)
    expect(cell("北", "已完成")?.count).toBe(1)
    expect(cell("南", "已完成")?.count).toBe(1)
    // 列小計(只有列軸、無欄軸)
    const rowTotal = res.cells.find((x) => x.rowKeys[0] === "北" && x.colKeys.length === 0)
    expect(rowTotal?.count).toBe(3)
    // 欄小計(只有欄軸、無列軸)
    const colTotal = res.cells.find((x) => x.rowKeys.length === 0 && x.colKeys[0] === "已完成")
    expect(colTotal?.count).toBe(2)
  })

  it("值(measure)可與列軸/欄軸同時計算", async () => {
    const { formId } = await salesForm(`值_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 區域: "北", 狀態: "新單", 金額: "100.0000" }, ALICE)
    await records.createRecord(tenantA, formId, { 區域: "北", 狀態: "新單", 金額: "50.0000" }, ALICE)
    const res = await records.pivot(
      tenantA,
      formId,
      pivotQ({
        colGroupBy: [{ field: "狀態", dir: "asc" }],
        aggregates: [{ field: "金額", fn: "sum" }],
      }),
      allPerms(formId),
      ALICE,
    )
    const cell = res.cells.find((x) => x.rowKeys[0] === "北" && x.colKeys[0] === "新單")
    expect(Number(cell?.measures["sum:金額"])).toBe(150)
  })

  it("🔴 P4:日期軸(date_trunc 表達式)不被 planner 拒絕 —— 須先物化成具名欄", async () => {
    const { formId } = await salesForm(`日期軸_${String(Date.now()).slice(-6)}`)
    for (const d of ["2026-01-05", "2026-01-20", "2026-03-01"]) {
      await records.createRecord(tenantA, formId, { 區域: "北", 下單日: d }, ALICE)
    }
    /* 表達式 breakout 同時出現在 GROUPING SETS 與 GROUPING() 時,
       planner 的 matcher 會視為不同運算式而整句拒絕(Metabase nest_for_pivot.clj)。
       本專案的日期分組正是 date_trunc,故此測試直接命中該陷阱。 */
    const res = await records.pivot(
      tenantA,
      formId,
      {
        rowGroupBy: [{ field: "下單日", dir: "asc", unit: "month" }],
        colGroupBy: [{ field: "區域", dir: "asc" }],
        aggregates: [],
        filters: [],
      },
      allPerms(formId),
      ALICE,
    )
    const jan = res.cells.find(
      (x) => String(x.rowKeys[0]).startsWith("2026-01") && x.colKeys[0] === "北",
    )
    expect(jan?.count).toBe(2)
  })

  it("🔴 P1:欄標頭只列出使用者看得到的維度值(CVE-2024-55951 的形狀)", async () => {
    const { formId } = await salesForm(`欄標頭洩漏_${String(Date.now()).slice(-6)}`)
    // ALICE 建三個區域的單,BOB 只建一個
    for (const r of ["北", "中", "南"]) {
      await records.createRecord(tenantA, formId, { 區域: r, 狀態: "新單" }, ALICE)
    }
    await records.createRecord(tenantA, formId, { 區域: "北", 狀態: "已完成" }, BOB)

    const scoped = new EffectivePermissions(
      false,
      new Map([[formId, new Set(["view"] as const)]]),
      new Map(),
      new Set(),
      new Map([[formId, new Set(["view"] as const)]]),
    )
    const res = await records.pivot(
      tenantA,
      formId,
      {
        rowGroupBy: [{ field: "狀態", dir: "asc" }],
        colGroupBy: [{ field: "區域", dir: "asc" }],
        aggregates: [],
        filters: [],
      },
      scoped,
      BOB,
    )
    // BOB 只看得到自己那筆(北)—— 欄標頭不得列出「中」「南」
    const cols = res.colHeaders.map((c) => c[0])
    expect(cols).toEqual(["北"])
  })

  it("🔴 P2:隱藏欄不得作為軸", async () => {
    const { formId, statusFieldId } = await salesForm(`隱藏軸_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 區域: "北", 狀態: "新單" }, ALICE)
    const hidden = new EffectivePermissions(
      false,
      new Map([[formId, new Set(["view"] as const)]]),
      new Map([[statusFieldId, "hidden" as const]]),
      new Set(),
    )
    await expect(
      records.pivot(
        tenantA,
        formId,
        {
          rowGroupBy: [{ field: "區域", dir: "asc" }],
          colGroupBy: [{ field: "狀態", dir: "asc" }],
          aggregates: [],
          filters: [],
        },
        hidden,
        ALICE,
      ),
    ).rejects.toThrow()
  })

  it("篩選同時作用於 pivot(母體與列表一致)", async () => {
    const { formId } = await salesForm(`母體_${String(Date.now()).slice(-6)}`)
    await records.createRecord(tenantA, formId, { 區域: "北", 狀態: "新單" }, ALICE)
    await records.createRecord(tenantA, formId, { 區域: "南", 狀態: "新單" }, ALICE)
    const res = await records.pivot(
      tenantA,
      formId,
      pivotQ({ filters: [{ field: "區域", op: "eq", value: "北" }] }),
      allPerms(formId),
      ALICE,
    )
    const total = res.cells.filter((c) => c.rowKeys.length === 1)
    expect(total).toHaveLength(1)
    expect(total[0]?.rowKeys[0]).toBe("北")
  })
})
