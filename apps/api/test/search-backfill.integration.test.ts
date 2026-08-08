import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import knexFactory, { type Knex } from "knex"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runMigrations } from "../src/db/migrate.js"
import { SearchBackfillService } from "../src/search/search-backfill.service.js"
import { SearchIndexService } from "../src/search/search-index.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

/* 🔴 R1·H-3 殘留 R1|既有資料的索引補寫(pilot 上線前必做)。

   本檔模擬的是**真實的上線情境**:資料早就在了,索引功能才剛上線。
   那些記錄從未經過任何會寫索引的路徑,所以搜不到 —— 而且**沒有錯誤訊息**,
   客戶只會發現「歷年的資料一筆都搜不到」。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Knex
let service: SearchBackfillService

const TENANT = 1
const OTHER_TENANT = 2
let formId = 0
let emptyFormId = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  const url = container.getConnectionUri()
  pool = testPool(url)
  await runMigrations(pool)
  db = knexFactory({ client: "pg", connection: url })
  service = new SearchBackfillService(db, new SearchIndexService())

  await pool.query("INSERT INTO tenants (name) VALUES ('甲廠'), ('乙廠')")

  /* 兩張表單:一張有可搜尋欄位、一張只有數值欄(應被跳過) */
  formId = await createForm("採購單", [
    { name: "品名", type: "text" },
    { name: "備註", type: "longText" },
    { name: "數量", type: "number" },
  ])
  emptyFormId = await createForm("純數值表", [{ name: "數量", type: "number" }])
}, 240_000)

afterAll(async () => {
  await db?.destroy()
  await pool?.end()
  await container?.stop()
})

async function createForm(
  name: string,
  fields: readonly { name: string; type: string }[],
): Promise<number> {
  const form = await pool.query<{ id: number; physical_table: string }>(
    "INSERT INTO form_def (tenant_id, name) VALUES ($1, $2) RETURNING id, physical_table",
    [TENANT, name],
  )
  /* ⚠️ pg 對 bigint 回傳字串 —— 不轉的話 `formId === emptyFormId` 這種比較會靜默失敗 */
  const id = Number(form.rows[0]?.id ?? 0)
  const table = form.rows[0]?.physical_table ?? ""

  /* `physical_column` 是 generated column(`'f' || id`),不可指定;
     型別欄叫 `cell_value_type`。fixture 必須照真實 schema,否則測到的是幻想。 */
  const cols: string[] = []
  let position = 0
  for (const f of fields) {
    position += 1
    const fd = await pool.query<{ physical_column: string }>(
      `INSERT INTO field_def (form_id, tenant_id, name, cell_value_type, db_field_type, position)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING physical_column`,
      [id, TENANT, f.name, f.type, f.type === "number" ? "numeric" : "text", position],
    )
    cols.push(`"${fd.rows[0]?.physical_column ?? ""}" text`)
  }
  /* 直接建實體表 —— 這一段刻意不走 DdlService:本測試要的是
     「表裡有資料但索引沒有」的狀態,而 DdlService 的路徑不產生那種狀態。 */
  await pool.query(`CREATE TABLE data."${table}" (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id bigint NOT NULL,
      deleted_at timestamptz,
      ${cols.join(", ")}
    )`)
  return id
}

/* 實體欄名是 `f<id>`(generated column)—— 逐次查出來,不硬編 */
async function physical(): Promise<{ table: string; cols: string[] }> {
  const t = await pool.query<{ physical_table: string }>(
    "SELECT physical_table FROM form_def WHERE id = $1",
    [formId],
  )
  const c = await pool.query<{ physical_column: string }>(
    "SELECT physical_column FROM field_def WHERE form_id = $1 ORDER BY id",
    [formId],
  )
  return {
    table: t.rows[0]?.physical_table ?? "",
    cols: c.rows.map((r) => r.physical_column),
  }
}

async function insertLegacyRecords(count: number): Promise<void> {
  const { table, cols } = await physical()
  const names = cols.map((c) => `"${c}"`).join(", ")
  for (let i = 1; i <= count; i += 1) {
    await pool.query(`INSERT INTO data."${table}" (tenant_id, ${names}) VALUES ($1,$2,$3,$4)`, [
      TENANT,
      `大成食品-${String(i)}`,
      `這是第 ${String(i)} 筆的備註`,
      String(i),
    ])
  }
}

const indexCount = async (): Promise<number> => {
  const r = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM search_doc WHERE tenant_id = $1",
    [TENANT],
  )
  return Number(r.rows[0]?.n ?? 0)
}

describe("🔴 既有資料補寫", () => {
  it("🔴 上線前的資料原本一筆都沒有索引", async () => {
    await insertLegacyRecords(3)
    expect(await indexCount()).toBe(0)
  })

  it("🔴 補寫後搜得到,且只索引文字型欄位", async () => {
    const result = await service.run(TENANT)
    expect(result.totalIndexed).toBe(3)

    /* 每筆兩個文字欄(品名 / 備註),數量是 number 不進索引 → 3 筆 × 2 = 6 列。
       若這裡變成 9,代表 number 也被索引了 —— 搜「1」會命中所有數量為 1 的記錄。 */
    expect(await indexCount()).toBe(6)

    const hit = await pool.query(
      "SELECT 1 FROM search_doc WHERE tenant_id=$1 AND value_text LIKE '%大成食品%'",
      [TENANT],
    )
    expect(hit.rowCount).toBeGreaterThan(0)
  })

  /* 🔴 營運工具一定會被重跑(中斷、不確定跑過沒、驗證)。
     不冪等的話重跑就是災難,而且要等到搜尋結果重複才發現。 */
  it("🔴 重跑不重複寫、不變更列數", async () => {
    const before = await indexCount()
    const again = await service.run(TENANT)
    expect(again.totalIndexed).toBe(0) // 已有索引者跳過
    expect(await indexCount()).toBe(before)
  })

  it("🔴 只補缺的:新增一筆未索引的記錄,只有它被補", async () => {
    await insertLegacyRecords(1)
    const result = await service.run(TENANT)
    expect(result.totalIndexed).toBe(1)
  })

  it("--force 會重寫既有索引(欄位改名 / 修 bug 後要用)", async () => {
    const result = await service.run(TENANT, { force: true })
    expect(result.totalIndexed).toBe(4)
  })

  it("沒有可搜尋欄位的表單被跳過,不做無謂掃描", async () => {
    const result = await service.run(TENANT)
    const empty = result.forms.find((f) => f.formId === emptyFormId)
    expect(empty?.scanned).toBe(0)
  })

  /* 🔴 soft delete 的記錄在使用者眼中已不存在,補寫不該讓它們復活在搜尋結果裡 */
  it("🔴 已刪除的記錄不進索引", async () => {
    const { table, cols } = await physical()
    await pool.query(
      `INSERT INTO data."${table}" (tenant_id, "${cols[0] ?? ""}", deleted_at)
       VALUES ($1,'已刪除的機密品名',now())`,
      [TENANT],
    )
    const before = await indexCount()
    await service.run(TENANT)
    expect(await indexCount()).toBe(before)

    const leaked = await pool.query(
      "SELECT 1 FROM search_doc WHERE value_text LIKE '%已刪除的機密%'",
    )
    expect(leaked.rowCount).toBe(0)
  })
})

describe("🔴 對帳", () => {
  it("🔴 補完後回報無缺漏", async () => {
    await service.run(TENANT)
    expect(await service.countMissing(TENANT)).toEqual([])
  })

  it("🔴 有記錄漏索引時報得出來,且**不會順手補掉**(對帳必須無副作用)", async () => {
    await insertLegacyRecords(2)
    const missing = await service.countMissing(TENANT)
    expect(missing).toHaveLength(1)
    expect(missing[0]?.missing).toBe(2)

    /* 再問一次還是 2 —— 若 countMissing 有副作用,第二次會變 0,
       而那會讓「上線前檢查」的腳本永遠看起來是通過的。 */
    expect((await service.countMissing(TENANT))[0]?.missing).toBe(2)
  })
})

describe("🔴 租戶邊界", () => {
  it("🔴 補寫甲廠不會碰到乙廠的表單", async () => {
    const result = await service.run(OTHER_TENANT)
    expect(result.forms).toHaveLength(0)
    expect(result.totalIndexed).toBe(0)
  })
})
