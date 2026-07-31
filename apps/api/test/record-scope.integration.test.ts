import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { AccessPreviewService } from "../src/form-engine/access/access-preview.service.js"
import { AuthzRepository } from "../src/authz/authz.repository.js"
import { EffectivePermissions } from "../src/authz/authz-effective.js"
import { PermissionService } from "../src/authz/permission.service.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"

/* 🔴 #96 E-1 記錄範圍。強制點在 `AS RESTRICTIVE` RLS policy(OQ-DP-7=B)——
   實測與應用層注入執行計畫相同,但語意恆為 AND:使用者篩選的 OR 逃不出去,
   且應用層漏注入也不外洩。 */

const ALICE = 101
const BOB = 202
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
/* 建表走特權 DDL 車道(需 CREATE);記錄讀寫走 **app 角色**車道 ——
   superuser 一律 bypass RLS,用它測範圍等於什麼都沒測。 */
let records: RecordService
let preview: AccessPreviewService
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

  const repo = new AuthzRepository(db, new TenantDb(db))
  preview = new AccessPreviewService(appKnex, new PermissionService(repo), repo)
}, 120_000)

afterAll(async () => {
  for (const d of destroyers) await d()
  await pool.end()
  await container.stop()
})

/* 只受 own 限制的 view 權限 */
const ownScoped = (formId: number): EffectivePermissions =>
  new EffectivePermissions(
    false,
    new Map([[formId, new Set(["view", "edit"] as const)]]),
    new Map(),
    new Set(),
    new Map([[formId, new Set(["view"] as const)]]),
  )

const allScoped = (formId: number): EffectivePermissions =>
  new EffectivePermissions(
    false,
    new Map([[formId, new Set(["view", "edit"] as const)]]),
    new Map(),
    new Set(),
  )

async function seed(): Promise<number> {
  const { form } = await ddl.createForm(
    tenantA,
    createFormSpecSchema.parse({
      name: `客戶_${String(Date.now()).slice(-6)}`,
      fields: [{ name: "客戶名稱", type: "text" }],
    }),
    ALICE,
  )
  await records.createRecord(tenantA, form.id, { 客戶名稱: "A的客戶1" }, ALICE)
  await records.createRecord(tenantA, form.id, { 客戶名稱: "A的客戶2" }, ALICE)
  await records.createRecord(tenantA, form.id, { 客戶名稱: "B的客戶" }, BOB)
  return form.id
}

const names = async (
  formId: number,
  perms: EffectivePermissions,
  actorId: number,
): Promise<string[]> => {
  const page = await records.listRecords(
    tenantA,
    formId,
    { filters: [], sort: [], limit: 50 },
    perms,
    actorId,
  )
  return page.records.map((r) => String(r.values.客戶名稱)).sort()
}

describe("🔴 記錄範圍:業務只看自己的客戶(#96)", () => {
  it("**own 範圍下只看得到自己建立的** —— Weyver 原本表單可見即所有記錄可見", async () => {
    const formId = await seed()
    expect(await names(formId, ownScoped(formId), ALICE)).toEqual(["A的客戶1", "A的客戶2"])
    expect(await names(formId, ownScoped(formId), BOB)).toEqual(["B的客戶"])
  })

  it("未設範圍時看得到全部(既有行為,零遷移)", async () => {
    const formId = await seed()
    expect(await names(formId, allScoped(formId), ALICE)).toHaveLength(3)
  })

  it("**強制點在 DB** —— 就算應用層完全不傳 policy,GUC 設了 own 仍濾得掉", async () => {
    const formId = await seed()
    // 直接對 DB 驗:設 own + actor=BOB,無論應用層做什麼都只剩 1 筆
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE weyver_app")
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantA)])
      await client.query(`SELECT set_config('app.record_scope', 'own', true)`)
      await client.query(`SELECT set_config('app.actor_id', $1, true)`, [String(BOB)])
      const res = await client.query(`SELECT count(*)::int AS n FROM data.t${formId}`)
      expect(res.rows[0].n).toBe(1)
      await client.query("ROLLBACK")
    } finally {
      client.release()
    }
  })

  it("**使用者自訂篩選的 OR 逃不出範圍** —— RESTRICTIVE 語意恆為 AND", async () => {
    const formId = await seed()
    const page = await records.listRecords(
      tenantA,
      formId,
      {
        filters: [
          { field: "客戶名稱", op: "contains", value: "A的" },
          { field: "客戶名稱", op: "contains", value: "B的" },
        ],
        combinator: "or",
        sort: [],
        limit: 50,
      },
      ownScoped(formId),
      ALICE,
    )
    // OR 讓兩邊都命中,但 RESTRICTIVE 仍把 B 的擋在外面
    expect(page.records.map((r) => String(r.values.客戶名稱)).sort()).toEqual([
      "A的客戶1",
      "A的客戶2",
    ])
  })

  it("被指派者看得到(assignees)—— 這是 Ragic 賴以達成此需求的機制", async () => {
    const formId = await seed()
    await pool.query(`UPDATE data.t${formId} SET assignees = ARRAY[$1::bigint] WHERE created_by = $2`, [
      BOB,
      ALICE,
    ])
    expect(await names(formId, ownScoped(formId), BOB)).toEqual([
      "A的客戶1",
      "A的客戶2",
      "B的客戶",
    ])
  })
})

describe("🔴 指派同步:member 欄勾 grantsAccess(#96 M2)", () => {
  it("**寫入時同步到 assignees** —— 資料即權限,不另維護一份指派表", async () => {
    const { form, fields } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `指派_${String(Date.now()).slice(-6)}`,
        fields: [
          { name: "客戶名稱", type: "text" },
          { name: "負責業務", type: "member", options: { grantsAccess: true } },
        ],
      }),
      ALICE,
    )
    void fields
    const rec = await records.createRecord(
      tenantA,
      form.id,
      { 客戶名稱: "指派給 BOB", 負責業務: BOB },
      ALICE,
    )

    const { rows } = await pool.query<{ assignees: string[] | null }>(
      `SELECT assignees FROM data.t${form.id} WHERE id = $1`,
      [rec.id],
    )
    expect(rows[0]?.assignees?.map(Number)).toEqual([BOB])

    // BOB 因為被指派而看得到(他不是建立者)
    expect(await names(form.id, ownScoped(form.id), BOB)).toEqual(["指派給 BOB"])
  })

  it("**改指派後舊的人就看不到了** —— 權限不得留在被移除的人身上", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `改派_${String(Date.now()).slice(-6)}`,
        fields: [
          { name: "客戶名稱", type: "text" },
          { name: "負責業務", type: "member", options: { grantsAccess: true } },
        ],
      }),
      ALICE,
    )
    const rec = await records.createRecord(
      tenantA,
      form.id,
      { 客戶名稱: "轉手客戶", 負責業務: BOB },
      ALICE,
    )
    expect(await names(form.id, ownScoped(form.id), BOB)).toEqual(["轉手客戶"])

    const CAROL = 303
    const current = await records.getRecord(tenantA, form.id, rec.id)
    await records.updateRecord(
      tenantA,
      form.id,
      rec.id,
      current.version,
      { 負責業務: CAROL },
      ALICE,
    )
    expect(await names(form.id, ownScoped(form.id), BOB)).toEqual([])
    expect(await names(form.id, ownScoped(form.id), CAROL)).toEqual(["轉手客戶"])
  })

  it("沒勾 grantsAccess 的 member 欄不影響權限", async () => {
    const { form } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `未勾_${String(Date.now()).slice(-6)}`,
        fields: [
          { name: "客戶名稱", type: "text" },
          { name: "聯絡人", type: "member" },
        ],
      }),
      ALICE,
    )
    await records.createRecord(tenantA, form.id, { 客戶名稱: "X", 聯絡人: BOB }, ALICE)
    expect(await names(form.id, ownScoped(form.id), BOB)).toEqual([])
  })
})


describe("🔴 預覽模擬器(#96 M3)", () => {
  it("**回「看得到幾筆 / 全部幾筆 + 每筆為什麼」** —— 只給一個數字管理員無從判斷對錯", async () => {
    const formId = await seed()
    const result = await preview.preview(tenantA, formId, ALICE)
    expect(result.totalCount).toBe(3)
    for (const s of result.samples) {
      expect(["owner", "assigned", "unrestricted"]).toContain(s.reason)
    }
  })

  it("**預覽與實際一致** —— 兩者若各寫一套判斷,管理員會相信一個錯的東西", async () => {
    const formId = await seed()
    // 沒有任何角色授權 → 看不到(deny-by-default),預覽也必須這樣說
    const result = await preview.preview(tenantA, formId, BOB)
    expect(result.visibleCount).toBe(0)
    expect(result.samples).toHaveLength(0)
    // 總數仍照實回報,讓管理員知道「這張表有 3 筆,但這個人一筆都看不到」
    expect(result.totalCount).toBe(3)
  })
})

/* 🔴 #113 sweep:範圍原本只接在列表路徑上。列表擋住了,但單筆讀 / 更新 / 刪除
   只要知道 id 就能繞過 —— 這正是「橫向防護只掛在一種路由形狀上」的老問題。 */
describe("🔴 記錄範圍必須涵蓋所有記錄路徑,不只列表", () => {
  const scopedFor = (formId: number, actions: readonly ("view" | "edit" | "delete")[]) =>
    new EffectivePermissions(
      false,
      new Map([[formId, new Set(["view", "edit", "delete"] as const)]]),
      new Map(),
      new Set(),
      new Map([[formId, new Set(actions)]]),
    )

  it("單筆讀取:BOB 用 id 直接讀 ALICE 的記錄 → 讀不到", async () => {
    const formId = await seed()
    const alicesOwn = await records.listRecords(
      tenantA,
      formId,
      { filters: [], sort: [], limit: 50 },
      allScoped(formId),
      ALICE,
    )
    const target = alicesOwn.records.find((r) => r.values.客戶名稱 === "A的客戶1")
    expect(target).toBeDefined()
    await expect(
      records.getRecord(tenantA, formId, target?.id ?? 0, scopedFor(formId, ["view"]), BOB),
    ).rejects.toThrow()
    // 自己的仍讀得到(證明不是把單筆讀取整個鎖死)
    const bobs = alicesOwn.records.find((r) => r.values.客戶名稱 === "B的客戶")
    const mine = await records.getRecord(
      tenantA,
      formId,
      bobs?.id ?? 0,
      scopedFor(formId, ["view"]),
      BOB,
    )
    expect(mine.values.客戶名稱).toBe("B的客戶")
  })

  it("更新:BOB 改不到 ALICE 的記錄", async () => {
    const formId = await seed()
    const all = await records.listRecords(
      tenantA,
      formId,
      { filters: [], sort: [], limit: 50 },
      allScoped(formId),
      ALICE,
    )
    const target = all.records.find((r) => r.values.客戶名稱 === "A的客戶1")
    await expect(
      records.updateRecord(
        tenantA,
        formId,
        target?.id ?? 0,
        target?.version ?? 1,
        { 客戶名稱: "被BOB改掉" },
        BOB,
        scopedFor(formId, ["edit"]),
      ),
    ).rejects.toThrow()
    // 值沒被動到
    const after = await records.getRecord(tenantA, formId, target?.id ?? 0, allScoped(formId))
    expect(after.values.客戶名稱).toBe("A的客戶1")
  })

  it("刪除:BOB 刪不掉 ALICE 的記錄", async () => {
    const formId = await seed()
    const all = await records.listRecords(
      tenantA,
      formId,
      { filters: [], sort: [], limit: 50 },
      allScoped(formId),
      ALICE,
    )
    const target = all.records.find((r) => r.values.客戶名稱 === "A的客戶2")
    await expect(
      records.softDeleteRecord(tenantA, formId, target?.id ?? 0, BOB, scopedFor(formId, ["delete"])),
    ).rejects.toThrow()
    const after = await records.getRecord(tenantA, formId, target?.id ?? 0, allScoped(formId))
    expect(after.values.客戶名稱).toBe("A的客戶2")
  })
})

/* 🔴 FMEA D3(#96 遺留):帶入欄把**另一張表**的資料顯示在這張表上。
   權限若只看本表,沒有客戶主檔權限的人就能透過訂單上的帶入欄把客戶資料整批讀出來。 */
describe("🔴 帶入(lookup)不得成為越權讀取的側門", () => {
  const SOURCE_RESTRICTED = "__source_restricted__"

  async function seedOrderWithLookup(): Promise<{
    customerFormId: number
    orderFormId: number
    customerFieldId: number
  }> {
    const stamp = String(Date.now()).slice(-6)
    const { form: customer } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `客戶主檔_${stamp}`,
        fields: [{ name: "客戶名稱", type: "text" }],
      }),
      ALICE,
    )
    const cust = await records.createRecord(tenantA, customer.id, { 客戶名稱: "機密客戶" }, ALICE)
    const { form: order } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `訂單_${stamp}`,
        fields: [
          { name: "客戶", type: "link", options: { targetFormId: customer.id } },
          {
            name: "客戶名",
            type: "lookup",
            options: { linkFieldName: "客戶", targetFieldName: "客戶名稱" },
          },
        ],
      }),
      BOB,
    )
    await records.createRecord(tenantA, order.id, { 客戶: cust.id }, BOB)
    const custFields = await records.getRecord(tenantA, customer.id, cust.id, allScoped(customer.id))
    void custFields
    return { customerFormId: customer.id, orderFormId: order.id, customerFieldId: cust.id }
  }

  const readOrderLookup = async (
    orderFormId: number,
    perms: EffectivePermissions,
    actorId: number,
  ): Promise<unknown> => {
    const page = await records.listRecords(
      tenantA,
      orderFormId,
      { filters: [], sort: [], limit: 10 },
      perms,
      actorId,
    )
    return page.records[0]?.values.客戶名
  }

  it("有訂單權、**沒有客戶主檔權** → 帶入值標記為無權,不外洩", async () => {
    const { orderFormId } = await seedOrderWithLookup()
    const onlyOrder = new EffectivePermissions(
      false,
      new Map([[orderFormId, new Set(["view"] as const)]]),
      new Map(),
      new Set(),
    )
    expect(await readOrderLookup(orderFormId, onlyOrder, BOB)).toBe(SOURCE_RESTRICTED)
  })

  it("兩張表都有權 → 正常帶出值(不是把帶入鎖死)", async () => {
    const { orderFormId, customerFormId } = await seedOrderWithLookup()
    const both = new EffectivePermissions(
      false,
      new Map([
        [orderFormId, new Set(["view"] as const)],
        [customerFormId, new Set(["view"] as const)],
      ]),
      new Map(),
      new Set(),
    )
    expect(await readOrderLookup(orderFormId, both, BOB)).toBe("機密客戶")
  })

  it("客戶主檔的記錄範圍為 own → 帶不出別人的客戶", async () => {
    const { orderFormId, customerFormId } = await seedOrderWithLookup()
    // 客戶由 ALICE 建立,BOB 對客戶主檔只看得到自己的
    const scopedOnCustomer = new EffectivePermissions(
      false,
      new Map([
        [orderFormId, new Set(["view"] as const)],
        [customerFormId, new Set(["view"] as const)],
      ]),
      new Map(),
      new Set(),
      new Map([[customerFormId, new Set(["view"] as const)]]),
    )
    expect(await readOrderLookup(orderFormId, scopedOnCustomer, BOB)).toBe(SOURCE_RESTRICTED)
  })
})

/* 欄位級閘單獨隔離:對來源表**有** view,但該欄被明確設為 hidden。
   這是 #100 那類破口的帶入版本 —— 表上遮住了,經由別張表的帶入欄又露出來。 */
describe("🔴 來源表上被隱藏的欄,不得經由帶入繞出來", () => {
  it("有來源表 view、目標欄 hidden → 帶入標記為無權", async () => {
    const stamp = String(Date.now()).slice(-6)
    const created = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `客戶_欄遮_${stamp}`,
        fields: [{ name: "客戶名稱", type: "text" }],
      }),
      ALICE,
    )
    const customer = created.form
    const secretFieldId = created.fields[0]?.id ?? 0
    const cust = await records.createRecord(tenantA, customer.id, { 客戶名稱: "不可見客戶" }, ALICE)
    const { form: order } = await ddl.createForm(
      tenantA,
      createFormSpecSchema.parse({
        name: `訂單_欄遮_${stamp}`,
        fields: [
          { name: "客戶", type: "link", options: { targetFormId: customer.id } },
          {
            name: "客戶名",
            type: "lookup",
            options: { linkFieldName: "客戶", targetFieldName: "客戶名稱" },
          },
        ],
      }),
      BOB,
    )
    await records.createRecord(tenantA, order.id, { 客戶: cust.id }, BOB)

    const perms = new EffectivePermissions(
      false,
      new Map([
        [order.id, new Set(["view"] as const)],
        [customer.id, new Set(["view"] as const)],
      ]),
      new Map([[secretFieldId, "hidden" as const]]),
      new Set(),
    )
    const page = await records.listRecords(
      tenantA,
      order.id,
      { filters: [], sort: [], limit: 10 },
      perms,
      BOB,
    )
    expect(page.records[0]?.values.客戶名).toBe("__source_restricted__")
  })
})
