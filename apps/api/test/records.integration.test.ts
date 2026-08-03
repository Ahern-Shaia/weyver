import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDdlKnex, createDrizzle, type DrizzleDb, TenantDb } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import {
  BulkValidationError,
  BulkTooLargeError,
  FieldValueError,
  InvalidFilterError,
  RecordNotFoundError,
  RequiredFieldError,
  SystemManagedFieldError,
  UnknownFieldError,
  VersionConflictError,
} from "../src/form-engine/errors.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { listQuerySchema } from "../src/form-engine/records/record-specs.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

const ACTOR = 1

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let knexDestroy: () => Promise<void>
let tenantA = 0
let tenantB = 0
let poFormId = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0
  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)

  const { form } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: "採購單",
      fields: [
        { name: "單號", type: "autoNumber", options: { prefix: "PO-", width: 4 } },
        { name: "供應商", type: "text", required: true },
        { name: "金額", type: "money" },
        { name: "狀態", type: "singleSelect", options: { choices: ["草稿", "待審", "核准"] } },
        { name: "標籤", type: "multiSelect", options: { choices: ["急件", "冷鏈", "進口"] } },
        { name: "交期", type: "date" },
      ],
    }),
  )
  poFormId = form.id
})

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

function q(input: Partial<Parameters<typeof listQuerySchema.parse>[0]> = {}) {
  return listQuerySchema.parse(input)
}

describe("A4 record DML on real PG", () => {
  it("createRecord persists values, generates autoNumber, sets system columns", async () => {
    const record = await records.createRecord(
      tenantA,
      poFormId,
      {
        供應商: "鑫豐農產品",
        金額: "128400.0000",
        狀態: "待審",
        標籤: ["急件", "冷鏈"],
        交期: "2026-07-22",
      },
      ACTOR,
    )
    expect(record.values.單號).toBe("PO-0001")
    expect(record.values.供應商).toBe("鑫豐農產品")
    expect(record.values.金額).toBe("128400.0000")
    expect(record.values.標籤).toEqual(["急件", "冷鏈"])
    // date 欄回傳純 "YYYY-MM-DD" 字串(pg DATE type parser 覆寫;非 Date 物件位移時區)
    expect(record.values.交期).toBe("2026-07-22")
    expect(record.version).toBe(1)
    expect(record.createdBy).toBe(ACTOR)

    const second = await records.createRecord(tenantA, poFormId, { 供應商: "正大食材" }, ACTOR)
    expect(second.values.單號).toBe("PO-0002")
  })

  it("createManyRecords: bulk inserts atomically with per-row autoNumber", async () => {
    const before = await records.listRecords(tenantA, poFormId, q({ limit: 200 }))
    const result = await records.createManyRecords(
      tenantA,
      poFormId,
      [{ 供應商: "批次A" }, { 供應商: "批次B" }, { 供應商: "批次C" }],
      ACTOR,
    )
    expect(result.created).toBe(3)
    const after = await records.listRecords(tenantA, poFormId, q({ limit: 200 }))
    expect(after.records.length).toBe(before.records.length + 3)
    // 每列取到不同 autoNumber
    const bulkNos = after.records
      .filter((r) => ["批次A", "批次B", "批次C"].includes(r.values.供應商 as string))
      .map((r) => r.values.單號)
    expect(new Set(bulkNos).size).toBe(3)
  })

  /* 🔴 追溯稽核改契約:原本第一列出錯即拋 BulkRowError,只回得到一列 ——
     5000 列有 30 個錯就要來回試 30 次。改為**全列預檢後一次回報**
     (承 Salesforce Data Loader / Ragic 之逐列錯誤報告)。 */
  it("createManyRecords: any bad row rolls back the whole batch (BulkValidationError)", async () => {
    const before = await records.listRecords(tenantA, poFormId, q({ limit: 200 }))
    const error = await records
      .createManyRecords(
        tenantA,
        poFormId,
        [{ 供應商: "好1" }, { 供應商: "好2" }, { 金額: 3.5 }], // 第 2 列(index 2)缺必填供應商 + float 金額
        ACTOR,
      )
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BulkValidationError)
    expect((error as BulkValidationError).failures.map((f) => f.rowIndex)).toEqual([2])
    const after = await records.listRecords(tenantA, poFormId, q({ limit: 200 }))
    expect(after.records.length).toBe(before.records.length) // 全 rollback,前兩列也沒進
  })

  /* 🔴 grid-paste M1|批次更新(網格貼上的寫入端)。
     貼上到既有列 = 大量 update,而此前只有單筆 PATCH。 */
  it("🔴 updateManyRecords:單一 tx 全成或全敗 —— 中間一列壞不得留下半套", async () => {
    const a = await records.createRecord(tenantA, poFormId, { 供應商: "改前A" }, ACTOR)
    const b = await records.createRecord(tenantA, poFormId, { 供應商: "改前B" }, ACTOR)

    const error = await records
      .updateManyRecords(
        tenantA,
        poFormId,
        [
          { recordId: a.id, values: { 供應商: "改後A" } },
          /* 金額為 money,給 float 會被驗證擋下 —— 用它當「中間一列壞掉」 */
          { recordId: b.id, values: { 供應商: "改後B", 金額: 3.5 } },
        ],
        ACTOR,
      )
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)

    /* 🔴 第一列不得留下來。逐格 PATCH 的世界裡它會 —— 那正是本方法存在的理由 */
    const after = await records.getRecord(tenantA, poFormId, a.id)
    expect(after.values.供應商).toBe("改前A")
  })

  it("updateManyRecords:計算欄跳過而不是整批拒絕,且回報跳過幾格", async () => {
    const rec = await records.createRecord(tenantA, poFormId, { 供應商: "含計算欄" }, ACTOR)
    /* 單號是 autoNumber(systemManaged)—— 從 Excel 複製一整塊很自然會含它 */
    const result = await records.updateManyRecords(
      tenantA,
      poFormId,
      [{ recordId: rec.id, values: { 供應商: "改過了", 單號: "PO-9999" } }],
      ACTOR,
    )
    expect(result.updated).toBe(1)
    expect(result.skippedComputedCells).toBe(1)
    const after = await records.getRecord(tenantA, poFormId, rec.id)
    expect(after.values.供應商).toBe("改過了")
    /* 自動編號沒有被貼上的值蓋掉 */
    expect(after.values.單號).not.toBe("PO-9999")
  })

  it("🔴 updateManyRecords:跨租戶的 recordId 影響 0 列(不是報錯,是根本改不到)", async () => {
    const mine = await records.createRecord(tenantA, poFormId, { 供應商: "A 的資料" }, ACTOR)
    await records
      .updateManyRecords(
        tenantB,
        poFormId,
        [{ recordId: mine.id, values: { 供應商: "B 想改 A 的" } }],
        ACTOR,
      )
      .catch(() => undefined)
    const after = await records.getRecord(tenantA, poFormId, mine.id)
    expect(after.values.供應商).toBe("A 的資料")
  })

  it("updateManyRecords:超過 500 列明確拒絕(不靜默截斷)", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      recordId: i + 1,
      values: { 供應商: "x" },
    }))
    await expect(records.updateManyRecords(tenantA, poFormId, rows, ACTOR)).rejects.toThrow(
      BulkTooLargeError,
    )
  })

  it("createManyRecords: rejects over-limit batches", async () => {
    const rows = Array.from({ length: 5001 }, () => ({ 供應商: "x" }))
    await expect(records.createManyRecords(tenantA, poFormId, rows, ACTOR)).rejects.toThrow(
      BulkTooLargeError,
    )
  })

  it("createManyRecords: tenant B cannot bulk into A's form", async () => {
    await expect(
      records.createManyRecords(tenantB, poFormId, [{ 供應商: "x" }], ACTOR),
    ).rejects.toThrow()
  })

  it("rejects bad writes: required / unknown / systemManaged / bad enum / float money", async () => {
    await expect(records.createRecord(tenantA, poFormId, {}, ACTOR)).rejects.toThrow(
      RequiredFieldError,
    )
    await expect(
      records.createRecord(tenantA, poFormId, { 供應商: "x", 幽靈欄: 1 }, ACTOR),
    ).rejects.toThrow(UnknownFieldError)
    await expect(
      records.createRecord(tenantA, poFormId, { 供應商: "x", 單號: "PO-9999" }, ACTOR),
    ).rejects.toThrow(SystemManagedFieldError)
    await expect(
      records.createRecord(tenantA, poFormId, { 供應商: "x", 狀態: "作廢" }, ACTOR),
    ).rejects.toThrow(FieldValueError)
    await expect(
      records.createRecord(tenantA, poFormId, { 供應商: "x", 金額: 128400.5 }, ACTOR),
    ).rejects.toThrow(FieldValueError)
  })

  it("filters: eq / contains(escaped) / gt / anyOf(multiSelect overlap)", async () => {
    await records.createRecord(
      tenantA,
      poFormId,
      { 供應商: "50%_特殊供應商", 金額: "99.0000", 狀態: "草稿", 標籤: ["進口"] },
      ACTOR,
    )

    const byStatus = await records.listRecords(
      tenantA,
      poFormId,
      q({ filters: [{ field: "狀態", op: "eq", value: "待審" }] }),
    )
    expect(byStatus.records).toHaveLength(1)

    const byContains = await records.listRecords(
      tenantA,
      poFormId,
      q({ filters: [{ field: "供應商", op: "contains", value: "50%_特" }] }),
    )
    expect(byContains.records).toHaveLength(1)
    const noInjection = await records.listRecords(
      tenantA,
      poFormId,
      q({ filters: [{ field: "供應商", op: "contains", value: "%" }] }),
    )
    expect(noInjection.records.map((r) => r.values.供應商)).toEqual(["50%_特殊供應商"])

    const byAmount = await records.listRecords(
      tenantA,
      poFormId,
      q({ filters: [{ field: "金額", op: "gt", value: "1000" }] }),
    )
    expect(byAmount.records).toHaveLength(1)

    const byTags = await records.listRecords(
      tenantA,
      poFormId,
      q({ filters: [{ field: "標籤", op: "anyOf", value: ["冷鏈", "進口"] }] }),
    )
    expect(byTags.records).toHaveLength(2)
  })

  it("rejects operator not allowed for the field type", async () => {
    await expect(
      records.listRecords(
        tenantA,
        poFormId,
        q({ filters: [{ field: "標籤", op: "contains", value: "急" }] }),
      ),
    ).rejects.toThrow(InvalidFilterError)
  })

  it("sorts and paginates with cursor", async () => {
    const all = await records.listRecords(tenantA, poFormId, q({ limit: 2 }))
    expect(all.records).toHaveLength(2)
    expect(all.nextCursor).not.toBeNull()
    const page2 = await records.listRecords(
      tenantA,
      poFormId,
      q({ limit: 2, cursor: all.nextCursor ?? undefined }),
    )
    expect(page2.records.length).toBeGreaterThan(0)
    const ids = [...all.records, ...page2.records].map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)

    const sorted = await records.listRecords(
      tenantA,
      poFormId,
      q({ sort: [{ field: "金額", dir: "desc" }] }),
    )
    const amounts = sorted.records.map((r) => r.values.金額)
    expect(amounts[0]).toBe("128400.0000")
  })

  it("optimistic lock: correct version updates, stale version conflicts", async () => {
    const created = await records.createRecord(tenantA, poFormId, { 供應商: "版本測試" }, ACTOR)
    const updated = await records.updateRecord(
      tenantA,
      poFormId,
      created.id,
      1,
      { 金額: "1.0000" },
      ACTOR,
    )
    expect(updated.version).toBe(2)
    await expect(
      records.updateRecord(tenantA, poFormId, created.id, 1, { 金額: "2.0000" }, ACTOR),
    ).rejects.toThrow(VersionConflictError)
  })

  it("soft delete hides the record; cross-tenant reads rejected", async () => {
    const created = await records.createRecord(tenantA, poFormId, { 供應商: "刪除測試" }, ACTOR)
    await records.softDeleteRecord(tenantA, poFormId, created.id, ACTOR)
    await expect(records.getRecord(tenantA, poFormId, created.id)).rejects.toThrow(
      RecordNotFoundError,
    )
    await expect(records.getRecord(tenantB, poFormId, created.id)).rejects.toThrow()
  })
})

describe("A5 subtable saveWithLines on real PG", () => {
  let orderFormId = 0
  let lineFormId = 0

  beforeAll(async () => {
    const parent = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "訂單",
        fields: [{ name: "客戶", type: "text", required: true }],
      }),
    )
    orderFormId = parent.form.id
    const child = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "訂單明細",
        parentFormId: orderFormId,
        fields: [
          { name: "品項", type: "text", required: true },
          { name: "數量", type: "number" },
        ],
      }),
    )
    lineFormId = child.form.id
  })

  it("creates header + lines atomically with line_no sequence", async () => {
    const saved = await records.saveWithLines(
      tenantA,
      orderFormId,
      lineFormId,
      { values: { 客戶: "查理布朗" } },
      [{ values: { 品項: "冷凍雞腿", 數量: 10 } }, { values: { 品項: "醬料包", 數量: 200 } }],
      ACTOR,
    )
    expect(saved.header.values.客戶).toBe("查理布朗")
    expect(saved.lines).toHaveLength(2)
    expect(saved.lines.map((l) => l.lineNo)).toEqual([1, 2])
    expect(saved.lines.every((l) => l.parentId === saved.header.id)).toBe(true)
  })

  it("diffs lines: update kept, soft-delete removed, insert new, resequence line_no", async () => {
    const first = await records.saveWithLines(
      tenantA,
      orderFormId,
      lineFormId,
      { values: { 客戶: "沅盆" } },
      [
        { values: { 品項: "A", 數量: 1 } },
        { values: { 品項: "B", 數量: 2 } },
        { values: { 品項: "C", 數量: 3 } },
      ],
      ACTOR,
    )
    const [lineA, , lineC] = first.lines
    if (lineA === undefined || lineC === undefined) throw new Error("lines missing")

    const second = await records.saveWithLines(
      tenantA,
      orderFormId,
      lineFormId,
      { id: first.header.id, expectedVersion: 1, values: { 客戶: "沅盆(改)" } },
      [
        { id: lineC.id, values: { 品項: "C", 數量: 30 } },
        { id: lineA.id, values: { 品項: "A改", 數量: 1 } },
        { values: { 品項: "D", 數量: 4 } },
      ],
      ACTOR,
    )
    expect(second.header.values.客戶).toBe("沅盆(改)")
    expect(second.lines).toHaveLength(3)
    expect(second.lines.map((l) => [l.values.品項, l.lineNo])).toEqual([
      ["C", 1],
      ["A改", 2],
      ["D", 3],
    ])
  })

  it("rolls back everything when one line fails", async () => {
    const before = await records.listRecords(tenantA, orderFormId, q({ limit: 200 }))
    await expect(
      records.saveWithLines(
        tenantA,
        orderFormId,
        lineFormId,
        { values: { 客戶: "失敗訂單" } },
        [
          { values: { 品項: "OK", 數量: 1 } },
          { values: { 品項: null } }, // required 違反 → 整包 rollback
        ],
        ACTOR,
      ),
    ).rejects.toThrow(RequiredFieldError)
    const after = await records.listRecords(tenantA, orderFormId, q({ limit: 200 }))
    expect(after.records.length).toBe(before.records.length)
    expect(after.records.some((r) => r.values.客戶 === "失敗訂單")).toBe(false)
  })
})

describe("R1·UP-2 records query:單層 combinator + 快速搜尋", () => {
  let vFormId = 0

  beforeAll(async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "供應商清單",
        fields: [
          { name: "名稱", type: "text", required: true },
          { name: "分類", type: "singleSelect", options: { choices: ["蔬菜", "水果", "肉品"] } },
          { name: "金額", type: "money" },
        ],
      }),
    )
    vFormId = form.id
    await records.createManyRecords(
      tenantA,
      vFormId,
      [
        { 名稱: "高麗菜", 分類: "蔬菜", 金額: "100.0000" },
        { 名稱: "蘋果", 分類: "水果", 金額: "200.0000" },
        { 名稱: "豬肉", 分類: "肉品", 金額: "300.0000" },
        { 名稱: "菠菜", 分類: "蔬菜", 金額: "50.0000" },
      ],
      ACTOR,
    )
  })

  it("combinator=or:跨條件聯集", async () => {
    const res = await records.listRecords(
      tenantA,
      vFormId,
      q({
        combinator: "or",
        filters: [
          { field: "分類", op: "eq", value: "水果" },
          { field: "分類", op: "eq", value: "肉品" },
        ],
      }),
    )
    expect(res.records.map((r) => r.values.名稱).sort()).toEqual(["蘋果", "豬肉"].sort())
  })

  it("combinator 缺省=and:交集", async () => {
    const res = await records.listRecords(
      tenantA,
      vFormId,
      q({
        filters: [
          { field: "分類", op: "eq", value: "蔬菜" },
          { field: "金額", op: "gt", value: "60" },
        ],
      }),
    )
    expect(res.records.map((r) => r.values.名稱)).toEqual(["高麗菜"])
  })

  it("combinator=or:tenant / deleted_at 留在 OR group 之外(不洩漏)", async () => {
    const doomed = await records.createRecord(
      tenantA,
      vFormId,
      { 名稱: "作廢水果", 分類: "水果" },
      ACTOR,
    )
    await records.softDeleteRecord(tenantA, vFormId, doomed.id, ACTOR)
    const res = await records.listRecords(
      tenantA,
      vFormId,
      q({
        combinator: "or",
        filters: [
          { field: "分類", op: "eq", value: "水果" },
          { field: "分類", op: "eq", value: "肉品" },
        ],
      }),
    )
    // 已軟刪之列不得因 OR 冒出(證明 deleted_at 為 group 外的 AND 邊界)
    expect(res.records.some((r) => r.values.名稱 === "作廢水果")).toBe(false)
  })

  it("快速搜尋 q:跨 textual 欄 ILIKE", async () => {
    const res = await records.listRecords(tenantA, vFormId, q({ q: "菜" }))
    expect(res.records.map((r) => r.values.名稱).sort()).toEqual(["菠菜", "高麗菜"].sort())
  })

  it("快速搜尋涵蓋 singleSelect(text 欄)", async () => {
    const res = await records.listRecords(tenantA, vFormId, q({ q: "水果" }))
    expect(res.records.map((r) => r.values.名稱)).toEqual(["蘋果"])
  })
})

describe("🔴 批次匯入預檢:一次回報全部問題列(追溯稽核)", () => {
  it("**多列有錯 → 一次全部回報**,而非只回第一列", async () => {
    const error = await records
      .createManyRecords(
        tenantA,
        poFormId,
        [
          { 供應商: "好1" },
          { 金額: 1.5 }, // index 1:缺必填
          { 供應商: "好3" },
          { 金額: 2.5 }, // index 3:缺必填
          { 不存在的欄: "x" }, // index 4:未知欄
        ],
        ACTOR,
      )
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BulkValidationError)
    /* 關鍵:原實作只會回 index 1;現在三列全報 */
    expect((error as BulkValidationError).failures.map((f) => f.rowIndex)).toEqual([1, 3, 4])
    for (const f of (error as BulkValidationError).failures) {
      expect(f.reason.length).toBeGreaterThan(0)
    }
  })

  it("全列有效 → 正常匯入(不誤傷)", async () => {
    const res = await records.createManyRecords(
      tenantA,
      poFormId,
      [{ 供應商: "甲" }, { 供應商: "乙" }],
      ACTOR,
    )
    expect(res.created).toBe(2)
  })
})
