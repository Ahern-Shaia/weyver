import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import knexFactory, { type Knex } from "knex"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { EffectivePermissions } from "../src/authz/authz-effective.js"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { CELL_VALUE_TYPES } from "../src/form-engine/field-types/field-type-registry.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { SearchBackfillService } from "../src/search/search-backfill.service.js"
import { SearchIndexService } from "../src/search/search-index.service.js"
import { SearchService } from "../src/search/search.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { testPool } from "./pg-pool.js"

/* 🔴 R1·H-3|跨表全文搜尋。本檔專攻兩條 P0 與繁中的實際行為。

   S1|跨租戶隔離 —— 這是「不上外部搜尋引擎」整個論證的基礎:
      留在 PG 內,RLS FORCE 原封不動執法;上外部引擎則此保證消失。
   S2|權限 pre-filter —— 若查完再濾,**結果筆數本身就是洩漏**。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: Knex
const index = new SearchIndexService()

const FIELDS = [
  { id: 501, name: "品名", type: "text" },
  { id: 502, name: "備註", type: "longText" },
  { id: 503, name: "數量", type: "number" }, // 非文字型 → 不該進索引
]

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  const url = container.getConnectionUri()
  pool = testPool(url)
  await runMigrations(pool)

  /* app 車道角色 —— RLS 只對非 owner 生效,用 owner 連線測等於沒測
     (pitfall_privileged_lane_masks_security:同一 session 踩五次) */
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='weyver_app') THEN
      CREATE ROLE weyver_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`)
  await pool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_doc TO weyver_app")

  db = knexFactory({ client: "pg", connection: url })
}, 180_000)

afterAll(async () => {
  await db?.destroy()
  await pool?.end()
  await container?.stop()
})

async function asTenant<T>(
  tenantId: number,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (trx) => {
    await trx.raw("SET LOCAL ROLE weyver_app")
    await trx.raw("SELECT set_config('app.tenant_id', ?, true)", [String(tenantId)])
    return fn(trx)
  })
}

describe("pg_bigm 與繁中", () => {
  it("擴充存在(測試映像須與 dev/prod 一致)", async () => {
    const r = await pool.query("SELECT 1 FROM pg_extension WHERE extname='pg_bigm'")
    expect(r.rowCount).toBe(1)
  })

  /* 🔴 這條釘住本模組的存在理由:PG 內建對繁中不可用 */
  it("PG 內建 to_tsvector 對繁中無效 —— 搜「食品」找不到「大成食品股份有限公司」", async () => {
    const r = await pool.query(
      "SELECT to_tsvector('simple','大成食品股份有限公司') @@ to_tsquery('simple','食品') AS hit",
    )
    expect(r.rows[0].hit).toBe(false)
  })

  it("bigram 可切出 2 字詞", async () => {
    const r = await pool.query("SELECT show_bigm('食品公司')::text AS b")
    expect(String(r.rows[0].b)).toContain("食品")
  })
})

/* 🔴 首版 SEARCHABLE 是手寫字串清單,裡面的 `textarea` / `richText` **兩個型別都不存在**,
   真正的長文字型別叫 `longText` → 備註欄從未進索引,而型別是 `string` 故編譯期抓不到。
   這組斷言對**真實的 CELL_VALUE_TYPES** 跑,清單再退回手寫就會紅。 */
describe("可搜尋型別由型別註冊表推導", () => {
  it("宣稱可搜尋的型別都真的存在;不存在的型別名不得通過", () => {
    const real = new Set<string>(CELL_VALUE_TYPES)
    for (const t of CELL_VALUE_TYPES) {
      if (SearchIndexService.isSearchable(t)) expect(real.has(t)).toBe(true)
    }
    expect(SearchIndexService.isSearchable("textarea")).toBe(false)
    expect(SearchIndexService.isSearchable("richText")).toBe(false)
  })

  it("🔴 長文字 / 單複選 / 條碼可搜;數值 · 日期 · 附件不可搜", () => {
    for (const t of [
      "text",
      "longText",
      "email",
      "url",
      "phone",
      "singleSelect",
      "multiSelect",
      "autoNumber",
      "barcode",
    ]) {
      expect(SearchIndexService.isSearchable(t), t).toBe(true)
    }
    for (const t of ["number", "money", "date", "dateTime", "checkbox", "attachment", "image"]) {
      expect(SearchIndexService.isSearchable(t), t).toBe(false)
    }
  })

  it("virtual(讀時計算)不進索引 —— 沒有寫入路徑通知更新,索引必然過期", () => {
    for (const t of ["lookup", "rollup", "createdBy", "updatedBy"]) {
      expect(SearchIndexService.isSearchable(t), t).toBe(false)
    }
  })
})

describe("索引寫入", () => {
  it("只索引文字型欄位,數值欄不進索引", async () => {
    await asTenant(1, (trx) =>
      index.upsertInTx(trx, {
        tenantId: 1,
        formId: 10,
        recordId: 100,
        fields: FIELDS,
        values: { 品名: "大成食品股份有限公司", 備註: "急件", 數量: 120 },
      }),
    )
    const rows = await asTenant(1, (trx) =>
      trx("search_doc").where({ record_id: 100 }).select("field_id"),
    )
    expect(rows.map((r) => Number(r.field_id)).sort()).toEqual([501, 502])
  })

  it("值被清空 → 該欄索引列移除(否則搜得到已不存在的內容)", async () => {
    await asTenant(1, (trx) =>
      index.upsertInTx(trx, {
        tenantId: 1,
        formId: 10,
        recordId: 100,
        fields: FIELDS,
        values: { 品名: "大成食品股份有限公司", 備註: null, 數量: 120 },
      }),
    )
    const rows = await asTenant(1, (trx) =>
      trx("search_doc").where({ record_id: 100 }).select("field_id"),
    )
    expect(rows.map((r) => Number(r.field_id))).toEqual([501])
  })

  it("記錄刪除 → 整筆移出索引", async () => {
    await asTenant(1, (trx) => index.removeInTx(trx, 1, 10, 100))
    const rows = await asTenant(1, (trx) => trx("search_doc").where({ record_id: 100 }).select("*"))
    expect(rows).toHaveLength(0)
  })

  /* 🔴 R4|批次版。真正的破口是 `createManyRecords` 從來沒呼叫過索引寫入
     (見 record.service 整合測),這裡釘住批次版本身的語意。 */
  it("批次版一次寫入多筆,且只收可搜欄位", async () => {
    await asTenant(1, (trx) =>
      index.upsertManyInTx(trx, {
        tenantId: 1,
        formId: 10,
        fields: FIELDS,
        records: [
          { recordId: 201, values: { 品名: "鮮勇冷凍雞胸", 備註: "整箱", 數量: 5 } },
          { recordId: 202, values: { 品名: "鮮勇雞腿排", 備註: null, 數量: 8 } },
        ],
      }),
    )
    const rows = await asTenant(1, (trx) =>
      trx("search_doc").whereIn("record_id", [201, 202]).select("record_id", "field_id"),
    )
    /* 201 兩欄、202 只有品名(備註為 null 不進索引) */
    expect(rows).toHaveLength(3)
    expect(rows.filter((r) => Number(r.record_id) === 202).map((r) => Number(r.field_id))).toEqual([
      501,
    ])
  })

  it("批次版可重跑(同一批再寫一次不重複也不失敗)", async () => {
    const write = (): Promise<void> =>
      asTenant(1, (trx) =>
        index.upsertManyInTx(trx, {
          tenantId: 1,
          formId: 10,
          fields: FIELDS,
          records: [{ recordId: 203, values: { 品名: "重跑測試" } }],
        }),
      )
    await write()
    await write()
    const rows = await asTenant(1, (trx) =>
      trx("search_doc").where({ record_id: 203 }).select("field_id"),
    )
    expect(rows).toHaveLength(1)
  })
})

/* 🔴 S1(P0)|跨租戶隔離 */
describe("S1:跨租戶隔離(RLS)", () => {
  beforeAll(async () => {
    await asTenant(1, (trx) =>
      index.upsertInTx(trx, {
        tenantId: 1,
        formId: 10,
        recordId: 200,
        fields: FIELDS,
        values: { 品名: "甲租戶的機密供應商", 備註: "" },
      }),
    )
    await asTenant(2, (trx) =>
      index.upsertInTx(trx, {
        tenantId: 2,
        formId: 20,
        recordId: 300,
        fields: FIELDS,
        values: { 品名: "乙租戶的機密供應商", 備註: "" },
      }),
    )
  })

  it("B 租戶搜不到 A 租戶的內容", async () => {
    const rows = await asTenant(2, (trx) =>
      trx("search_doc").where("value_text", "like", "%甲租戶%").select("*"),
    )
    expect(rows).toHaveLength(0)
  })

  it("🔴 無 WHERE 的全表查詢也不洩漏(RLS 兜底,非靠應用層記得加條件)", async () => {
    const rows = await asTenant(2, (trx) => trx("search_doc").select("tenant_id"))
    expect(rows.every((r) => Number(r.tenant_id) === 2)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  /* 🔴 RLS 三層語意 —— 由反向驗證與實測釐清,寫下以免日後誤解:

       · `ENABLE`  → **非 owner** 受 RLS 管(weyver_app 即靠這層)
       · `FORCE`   → **連 owner 也受管**(防「應用不慎以 owner 連線」)
       · superuser / `BYPASSRLS` → **兩者皆無效,完全繞過**

     反向驗證發現:單獨移除 `FORCE` 時上面三條**仍全綠**,因為測試走 weyver_app
     (非 owner),`ENABLE` 就夠了。而 testcontainer 的預設使用者實測為
     **superuser + BYPASSRLS**,故無法用它示範 `FORCE`。

     ⚠️ **本專案已知失效型**(`pitfall_privileged_lane_masks_security`,同一 session 踩五次):
     **用特權連線寫的測試,RLS 根本沒被執法,測試綠但線上漏。**
     故本檔所有隔離測試一律 `SET LOCAL ROLE weyver_app`。 */
  it("🔴 特權連線會繞過 RLS —— 故測試必須走 app 車道", async () => {
    const priv = await pool.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
    /* 這條不是在測產品,是在**釘住測試方法本身的前提**:
       若哪天預設使用者不再是 superuser,上面的 asTenant 假設就要重新檢視 */
    expect(priv.rows[0].rolsuper || priv.rows[0].rolbypassrls).toBe(true)
  })

  it("🔴 寫入時無法偽造他租戶(WITH CHECK)", async () => {
    await expect(
      asTenant(2, (trx) =>
        trx("search_doc").insert({
          tenant_id: 1,
          form_id: 10,
          record_id: 999,
          field_id: 501,
          field_name: "品名",
          value_text: "偽造",
        }),
      ),
    ).rejects.toThrow()
  })
})

/* 🔴 S2(P0)|權限 pre-filter */
describe("S2:權限 pre-filter(結果筆數不得洩漏)", () => {
  /* 用獨立 recordId 且在本 describe 內自備資料 —— 首版沿用前面被刪過的 record,
     導致「查不到」是因為資料不存在而非 pre-filter 生效(測試因錯的理由通過)。 */
  beforeAll(async () => {
    await asTenant(1, (trx) =>
      index.upsertInTx(trx, {
        tenantId: 1,
        formId: 10,
        recordId: 400,
        fields: FIELDS,
        values: { 品名: "公開品名", 備註: "薪資結構表" },
      }),
    )
  })

  it("隱藏欄的內容不得出現在搜尋結果", async () => {
    /* 模擬「備註(502)為 hidden」的 pre-filter —— 條件進 WHERE,不是查完再濾 */
    const rows = await asTenant(1, (trx) =>
      trx("search_doc")
        .where("value_text", "like", "%薪資%")
        .whereNotIn("field_id", [502])
        .select("*"),
    )
    expect(rows).toHaveLength(0)
  })

  it("有權限的欄位仍搜得到(不是一律不索引 —— 較 Ragic 完整)", async () => {
    const rows = await asTenant(1, (trx) =>
      trx("search_doc").where("value_text", "like", "%薪資%").select("field_name"),
    )
    expect(rows.map((r) => String(r.field_name))).toContain("備註")
  })
})

describe("EffectivePermissions 契約", () => {
  it("admin 可讀全部表", () => {
    const p = new EffectivePermissions(true, new Map(), new Map(), new Set())
    expect(p.readableFormIds([10, 20])).toEqual([10, 20])
  })
})

/* 🔴 服務層端到端 —— 上面的 describe 都直接對 `search_doc` 下 SQL,**繞過了 SearchService**,
   因此漏掉一個真實 bug:`SearchService.search()` 原本直接用 APP_KNEX 查,
   沒有進 `set_config('app.tenant_id')` 的交易 → RLS 把結果全濾光,API 一律回空。

   ⚠️ 那個失效**不會拋錯**,兩種結局都很安靜:
     · app 車道(無 BYPASSRLS)→ 回空(壞掉但安全)
     · 若回落特權連線 → 回**全部租戶**的資料(靜默洩漏)
   所以這一層非測不可。本段走真表:建表 → 建記錄 → 呼叫 service。 */
describe("🔴 SearchService 端到端(建表 → 建記錄 → 搜尋)", () => {
  let ddl: DdlService
  let records: RecordService
  let search: SearchService
  let drizzle: DrizzleDb
  let privilegedKnex: Knex
  let tenantA = 0
  let tenantB = 0
  const cleanup: (() => Promise<void>)[] = []

  beforeAll(async () => {
    drizzle = createDrizzle(pool)
    const rows = await drizzle
      .insert(tenants)
      .values([{ name: "端到端甲" }, { name: "端到端乙" }])
      .returning()
    tenantA = rows[0]?.id ?? 0
    tenantB = rows[1]?.id ?? 0

    const metadata = new MetadataService(drizzle, new TenantDb(drizzle))
    const uri = container.getConnectionUri()
    const ddlKnex = createDdlKnex(uri)
    privilegedKnex = ddlKnex
    cleanup.push(() => ddlKnex.destroy())
    ddl = new DdlService(ddlKnex, drizzle, metadata)

    /* app 車道:必須是無 BYPASSRLS 的登入角色,否則 RLS 不執法,
       這一段就會在「什麼都沒驗到」的情況下全綠 */
    await pool.query(
      `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
    )
    const appUri = new URL(uri)
    appUri.username = "app_login"
    appUri.password = "app_login"
    const appKnex = createDdlKnex(appUri.toString())
    cleanup.push(() => appKnex.destroy())

    records = new RecordService(
      appKnex,
      metadata,
      undefined,
      undefined,
      undefined,
      undefined,
      index,
    )
    search = new SearchService(appKnex, metadata)
  }, 120_000)

  afterAll(async () => {
    for (const c of cleanup) await c()
  })

  async function seedForm(tenantId: number, name: string, value: string): Promise<number> {
    const { form } = await ddl.createForm(
      tenantId,
      createFormSpecSchema.parse({ name, fields: [{ name: "品名", type: "text" }] }),
      1,
    )
    await records.createRecord(tenantId, form.id, { 品名: value }, 1)
    return form.id
  }

  const admin = new EffectivePermissions(true, new Map(), new Map(), new Set())

  it("🔴 建完記錄立刻搜得到 —— 索引寫入與查詢都要在租戶交易內", async () => {
    await seedForm(tenantA, "端到端甲表", "鮮勇冷凍蔬菜")
    const r = await search.search(tenantA, "鮮勇", admin)
    expect(r.hits.map((h) => h.snippet)).toContain("鮮勇冷凍蔬菜")
    expect(r.hits[0]?.fieldName).toBe("品名")
  })

  it("跨表:兩張不同的表各自命中", async () => {
    await seedForm(tenantA, "端到端甲表2", "鮮勇常溫飲品")
    const r = await search.search(tenantA, "鮮勇", admin)
    expect(new Set(r.hits.map((h) => h.formId)).size).toBeGreaterThanOrEqual(2)
  })

  it("🔴 乙租戶搜得到自己的、搜不到甲租戶的(不是因為沒資料才搜不到)", async () => {
    await seedForm(tenantB, "端到端乙表", "乙租戶自有品名")
    const own = await search.search(tenantB, "乙租戶", admin)
    expect(own.hits).toHaveLength(1)
    const other = await search.search(tenantB, "鮮勇", admin)
    expect(other.hits).toHaveLength(0)
  })

  /* 🔴 手寫清單時代 `longText` 不在 SEARCHABLE 裡 —— 備註 / 說明這類最常被搜尋的欄位
     從未進索引,且完全不報錯。這條走真 DDL,是那個 bug 的使用者可見版本。 */
  it("🔴 長文字(longText)欄位的內容搜得到", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "端到端長文字表",
        fields: [
          { name: "品名", type: "text" },
          { name: "備註", type: "longText" },
        ],
      }),
      1,
    )
    await records.createRecord(
      tenantA,
      form.id,
      { 品名: "冷凍毛豆", 備註: "本批需冷鏈配送,到貨後兩小時內入庫" },
      1,
    )
    const r = await search.search(tenantA, "冷鏈", admin)
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]?.fieldName).toBe("備註")
  })

  it("記錄刪除後即從搜尋結果消失", async () => {
    const formId = await seedForm(tenantA, "端到端刪除表", "待刪除的品名")
    const before = await search.search(tenantA, "待刪除", admin)
    expect(before.hits).toHaveLength(1)
    const recId = before.hits[0]?.recordId ?? 0
    await records.softDeleteRecord(tenantA, formId, recId, 1)
    const after = await search.search(tenantA, "待刪除", admin)
    expect(after.hits).toHaveLength(0)
  })

  /* 🔴 R4|**批次匯入此前完全沒有寫索引** —— Excel 匯進來的資料一筆都搜不到,
     而那對遷移中的客戶就是他的全部資料。沒有錯誤訊息,只有「搜尋看起來好好的」:
     用表單新建的搜得到,匯入的搜不到。

     這個破口躲了這麼久,正是因為單筆與批次共用 `insertOne` 卻**不共用索引寫入**,
     而沒有任何一條測試對批次路徑斷言過搜尋結果。dev DB 實跑 backfill --check
     也證實了它:未索引的表單名清一色是 `E2E匯入` 與子表主檔明細。 */
  it("🔴 批次建立的記錄搜得到(Excel 匯入走這條)", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "端到端批次表",
        fields: [{ name: "品名", type: "text" }],
      }),
      1,
    )
    await records.createManyRecords(
      tenantA,
      form.id,
      [{ 品名: "批次匯入的冷凍蝦仁" }, { 品名: "批次匯入的冷凍花枝" }],
      1,
    )
    const r = await search.search(tenantA, "批次匯入", admin)
    expect(r.hits).toHaveLength(2)
  })

  /* 🔴 對帳的假警報。可搜欄位全空的記錄本來就寫不出索引列,但對帳原本只看
     「有沒有索引列」→ 補寫完立刻又報同一批,永遠不會歸零。
     dev 實測就是這樣:form #12 只有一個 barcode 欄且三筆全空,
     `--check` 恆紅、CLI 恆 exit 1。恆紅的檢查等於沒有檢查。 */
  it("🔴 可搜欄位全空的記錄不算缺漏(否則對帳永遠歸不了零)", async () => {
    const backfill = new SearchBackfillService(privilegedKnex, index)
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "端到端空值表",
        fields: [
          { name: "數量", type: "number" },
          { name: "條碼", type: "barcode" },
        ],
      }),
      1,
    )
    /* 條碼(唯一的可搜欄位)留空 —— 這筆記錄不該有索引列,也不該被當成缺漏 */
    await records.createRecord(tenantA, form.id, { 數量: 3 }, 1)
    const missing = await backfill.countMissing(tenantA)
    expect(missing.map((m) => m.formId)).not.toContain(form.id)
  })

  it("🔴 主檔與明細(saveWithLines)都搜得到,移除的明細則消失", async () => {
    const parent = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({ name: "端到端主檔", fields: [{ name: "單號", type: "text" }] }),
      1,
    )
    const child = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: "端到端明細",
        parentFormId: parent.form.id,
        fields: [{ name: "品項", type: "text" }],
      }),
      1,
    )
    const saved = await records.saveWithLines(
      tenantA,
      parent.form.id,
      child.form.id,
      { values: { 單號: "訂單編號測試甲" } },
      [{ values: { 品項: "明細品項甲" } }, { values: { 品項: "明細品項乙" } }],
      1,
    )
    expect((await search.search(tenantA, "訂單編號測試", admin)).hits).toHaveLength(1)
    expect((await search.search(tenantA, "明細品項", admin)).hits).toHaveLength(2)

    /* 明細被拿掉之後不該還搜得到 —— 否則刪掉的品項會一直留在搜尋結果裡 */
    const keep = saved.lines[0]
    await records.saveWithLines(
      tenantA,
      parent.form.id,
      child.form.id,
      {
        values: { 單號: "訂單編號測試甲" },
        id: saved.header.id,
        expectedVersion: saved.header.version,
      },
      [{ values: { 品項: "明細品項甲" }, id: keep?.id }],
      1,
    )
    expect((await search.search(tenantA, "明細品項", admin)).hits).toHaveLength(1)
  })
})
