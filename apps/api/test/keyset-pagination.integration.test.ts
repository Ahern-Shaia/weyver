import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 #95 keyset 分頁。原本排序是 `sortCol, id` 但續頁條件是 `id > cursor`,
   兩者對不起來 —— 依非 id 欄排序時整頁被跳過,而使用者看不出少了東西。 */

const ACTOR = 1
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let knexDestroy: () => Promise<void>
let tenantA = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 8 })
  await runMigrations(pool)
  db = createDrizzle(pool)
  const rows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  const metadata = new MetadataService(db, new TenantDb(db))
  const ddlKnex = createDdlKnex(container.getConnectionUri())
  knexDestroy = () => ddlKnex.destroy()
  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(ddlKnex, metadata)
}, 120_000)

afterAll(async () => {
  await knexDestroy()
  await pool.end()
  await container.stop()
})

/* 刻意讓「插入順序」與「排序順序」相反 —— 這正是原本 bug 現形的條件 */
async function seedForm(
  name: string,
  values: readonly { 名稱: string; 分數: number | null }[],
): Promise<number> {
  const { form } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name,
      fields: [
        { name: "名稱", type: "text" },
        { name: "分數", type: "number" },
      ],
    }),
    ACTOR,
  )
  for (const v of values) await records.createRecord(tenantA, form.id, v, ACTOR)
  return form.id
}

/* 走完所有頁,回傳依序取得的「名稱」 */
async function pageThrough(
  formId: number,
  sort: readonly { field: string; dir: "asc" | "desc" }[],
  limit: number,
): Promise<string[]> {
  const out: string[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 50; guard++) {
    const page = await records.listRecords(tenantA, formId, {
      filters: [],
      sort: [...sort],
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    })
    out.push(...page.records.map((r) => String(r.values.名稱)))
    if (page.nextCursor === null) return out
    cursor = page.nextCursor
  }
  throw new Error("分頁未收斂")
}

describe("🔴 依非 id 欄排序時的分頁(#95)", () => {
  it("**逐頁取回的結果要與一次取完完全相同** —— 原本會整批跳過", async () => {
    // 插入順序 id 遞增,但分數遞減 → id 序與排序序完全相反
    const formId = await seedForm(
      "跳列",
      Array.from({ length: 12 }, (_, i) => ({ 名稱: `r${String(i)}`, 分數: 100 - i })),
    )

    const all = await pageThrough(formId, [{ field: "分數", dir: "asc" }], 100)
    const paged = await pageThrough(formId, [{ field: "分數", dir: "asc" }], 3)

    expect(paged).toEqual(all)
    expect(paged).toHaveLength(12)
    expect(new Set(paged).size).toBe(12) // 不得重複
  })

  it("desc 方向同樣正確", async () => {
    const formId = await seedForm(
      "降冪",
      Array.from({ length: 10 }, (_, i) => ({ 名稱: `d${String(i)}`, 分數: i })),
    )
    const all = await pageThrough(formId, [{ field: "分數", dir: "desc" }], 100)
    const paged = await pageThrough(formId, [{ field: "分數", dir: "desc" }], 4)
    expect(paged).toEqual(all)
  })

  it("**同值列不得在頁與頁之間漂移或漏掉** —— id 尾鍵的意義", async () => {
    const formId = await seedForm(
      "同值",
      Array.from({ length: 9 }, (_, i) => ({ 名稱: `s${String(i)}`, 分數: 5 })),
    )
    const paged = await pageThrough(formId, [{ field: "分數", dir: "asc" }], 2)
    expect(paged).toHaveLength(9)
    expect(new Set(paged).size).toBe(9)
  })

  it("**NULL 沉底且不被跳過**(NULLS LAST)", async () => {
    const formId = await seedForm("空值", [
      { 名稱: "a", 分數: 3 },
      { 名稱: "b", 分數: null },
      { 名稱: "c", 分數: 1 },
      { 名稱: "d", 分數: null },
      { 名稱: "e", 分數: 2 },
    ])
    const all = await pageThrough(formId, [{ field: "分數", dir: "asc" }], 100)
    const paged = await pageThrough(formId, [{ field: "分數", dir: "asc" }], 2)
    expect(paged).toEqual(all)
    expect(paged.slice(0, 3)).toEqual(["c", "e", "a"])
    expect(paged.slice(3).sort()).toEqual(["b", "d"])
  })

  it("多重排序鍵(混合方向)亦正確", async () => {
    const formId = await seedForm("多鍵", [
      { 名稱: "甲", 分數: 1 },
      { 名稱: "乙", 分數: 1 },
      { 名稱: "丙", 分數: 2 },
      { 名稱: "丁", 分數: 2 },
      { 名稱: "戊", 分數: 1 },
    ])
    const sort = [
      { field: "分數", dir: "asc" as const },
      { field: "名稱", dir: "desc" as const },
    ]
    expect(await pageThrough(formId, sort, 2)).toEqual(await pageThrough(formId, sort, 100))
  })

  it("無排序時仍以 id 續頁(既有行為不變)", async () => {
    const formId = await seedForm(
      "無排序",
      Array.from({ length: 7 }, (_, i) => ({ 名稱: `n${String(i)}`, 分數: i })),
    )
    const paged = await pageThrough(formId, [], 3)
    expect(paged).toEqual(["n0", "n1", "n2", "n3", "n4", "n5", "n6"])
  })

  it("壞掉的權杖當作從頭開始,不拋錯(舊版前端 / 被截斷的網址)", async () => {
    const formId = await seedForm("壞權杖", [{ 名稱: "x", 分數: 1 }])
    const page = await records.listRecords(tenantA, formId, {
      filters: [],
      sort: [],
      limit: 10,
      cursor: "!!!not-base64!!!",
    })
    expect(page.records).toHaveLength(1)
  })
})
