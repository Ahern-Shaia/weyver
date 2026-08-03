import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Knex } from "knex"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type DrizzleDb, TenantDb, createDdlKnex, createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { RecordService } from "../src/form-engine/records/record.service.js"
import { createFormSpecSchema } from "../src/form-engine/specs/form-specs.js"
import { PublicFormService } from "../src/public-form/public-form.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 G-2 公開表單。這份測試的核心不是「功能會動」,而是**不該外洩的沒外洩**:
   1. 白名單是 opt-in —— 沒選的欄位訪客看不到也送不進來
   2. 危險型別擋在設計期(link 會列舉來源表、autoNumber 洩漏業務量…)
   3. 匿名提交**不進動態表**,先落待審收件匣
   4. 查無 token 與已關閉回同一種訊息(不可用試 token 探測表單是否存在) */

const ALICE = 801
let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: DrizzleDb
let ddl: DdlService
let records: RecordService
let publicForms: PublicFormService
let ddlKnex: Knex
const destroyers: (() => Promise<void>)[] = []
let tenantA = 0
let tenantB = 0

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
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS; GRANT weyver_app TO app_login`,
  )
  const metadata = new MetadataService(db, new TenantDb(db))
  ddlKnex = createDdlKnex(container.getConnectionUri())
  destroyers.push(() => ddlKnex.destroy())

  const uri = new URL(container.getConnectionUri())
  uri.username = "app_login"
  uri.password = "app_login"
  const appKnex = createDdlKnex(uri.toString())
  destroyers.push(() => appKnex.destroy())
  const appPool = new pg.Pool({ connectionString: uri.toString(), max: 5 })
  destroyers.push(() => appPool.end())
  const appDb = createDrizzle(appPool)

  ddl = new DdlService(ddlKnex, db, metadata)
  records = new RecordService(appKnex, metadata)
  publicForms = new PublicFormService(new TenantDb(appDb), db)
}, 180_000)

afterAll(async () => {
  for (const d of destroyers) await d()
  await pool.end()
  await container.stop()
})

interface Built {
  formId: number
  fields: Record<string, number>
}

async function buildForm(tenantId: number, name: string, specFields: unknown[]): Promise<Built> {
  const { form, fields } = await ddl.createForm(
    tenantId,
    createFormSpecSchema.parse({ name, fields: specFields }),
  )
  return { formId: form.id, fields: Object.fromEntries(fields.map((f) => [f.name, f.id])) }
}

const textField = (name: string) => ({ name, type: "text" })

describe("G-2 白名單", () => {
  it("🔴 未列入白名單的欄位:訪客看不到", async () => {
    const built = await buildForm(tenantA, "白名單_基本", [
      textField("公司名稱"),
      textField("報價"),
      textField("內部備註"),
    ])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "供應商報價",
      fieldIds: [built.fields.公司名稱 ?? 0, built.fields.報價 ?? 0],
    })
    const view = await publicForms.resolvePublicForm(share.token)
    const names = view.fields.map((f) => f.name)
    expect(names).toEqual(["公司名稱", "報價"])
    expect(names).not.toContain("內部備註")
  })

  it("🔴 提交時多送未列入的欄位 → 靜默丟棄(不報錯,報錯等於確認欄位存在)", async () => {
    const built = await buildForm(tenantA, "白名單_丟棄", [
      textField("公司名稱"),
      textField("成本"),
    ])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "報價",
      fieldIds: [built.fields.公司名稱 ?? 0],
    })
    const { submissionId } = await publicForms.submit({
      token: share.token,
      values: { 公司名稱: "甲公司", 成本: "偷塞的", 根本不存在的欄: "x" },
      ipHash: null,
      userAgent: null,
    })
    const row = await ddlKnex("public_submission").where({ id: submissionId }).first()
    expect(row?.values).toEqual({ 公司名稱: "甲公司" })
  })

  it.each([
    ["autoNumber", "連號洩漏業務量"],
    ["createdBy", "洩漏內部人員名冊"],
    ["attachment", "需掃毒但平台尚未具備"],
  ])("🔴 %s 型別不得公開(%s)", async (type) => {
    const built = await buildForm(tenantA, `禁型別_${type}`, [
      textField("名稱"),
      { name: "危險欄", type },
    ])
    await expect(
      publicForms.create(tenantA, ALICE, {
        formId: built.formId,
        title: "x",
        fieldIds: [built.fields.名稱 ?? 0, built.fields.危險欄 ?? 0],
      }),
    ).rejects.toThrow(/不得公開/)
  })

  /* 🔴 link 單獨測:它是研究裡**實證過**的最大破口 ——
     Airtable 社群與支援一致確認表單上的 linked record 欄會讓填表者
     看到來源表全部記錄的 primary field,且可被爬取。 */
  it("🔴 link 型別不得公開(下拉候選會列舉來源表的所有記錄)", async () => {
    const target = await buildForm(tenantA, "客戶主檔_機密", [textField("客戶名稱")])
    const built = await buildForm(tenantA, "禁型別_link", [
      textField("名稱"),
      { name: "客戶", type: "link", options: { targetFormId: target.formId } },
    ])
    await expect(
      publicForms.create(tenantA, ALICE, {
        formId: built.formId,
        title: "x",
        fieldIds: [built.fields.名稱 ?? 0, built.fields.客戶 ?? 0],
      }),
    ).rejects.toThrow(/列舉來源表/)
  })

  it("空白名單被拒(避免「開了一張什麼都沒有的表單」)", async () => {
    const built = await buildForm(tenantA, "白名單_空", [textField("名稱")])
    await expect(
      publicForms.create(tenantA, ALICE, { formId: built.formId, title: "x", fieldIds: [] }),
    ).rejects.toThrow(/至少要選一個/)
  })

  it("其他表單的欄位 id 塞不進來", async () => {
    const a = await buildForm(tenantA, "白名單_越界A", [textField("A欄")])
    const b = await buildForm(tenantA, "白名單_越界B", [textField("B欄")])
    await expect(
      publicForms.create(tenantA, ALICE, {
        formId: a.formId,
        title: "x",
        fieldIds: [b.fields.B欄 ?? 0],
      }),
    ).rejects.toThrow(/不屬於這張表單/)
  })
})

describe("G-2 提交隔離", () => {
  it("🔴 匿名提交**不寫進動態表**,只落待審收件匣", async () => {
    const built = await buildForm(tenantA, "隔離_不進表", [textField("公司名稱")])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "報價",
      fieldIds: [built.fields.公司名稱 ?? 0],
    })
    await publicForms.submit({
      token: share.token,
      values: { 公司名稱: "乙公司" },
      ipHash: "hash",
      userAgent: "UA",
    })

    /* 動態表必須是空的 —— 這是「不吃正式單號、不觸發簽核」的structural保證 */
    const inTable = await ddlKnex
      .withSchema("data")
      .table(`t${String(built.formId)}`)
      .select("*")
    expect(inTable).toHaveLength(0)

    const inbox = await publicForms.inbox(tenantA)
    expect(inbox.some((s) => (s.values as Record<string, unknown>).公司名稱 === "乙公司")).toBe(
      true,
    )
  })

  it("promote 後才真正建立記錄", async () => {
    const built = await buildForm(tenantA, "隔離_promote", [textField("公司名稱")])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "報價",
      fieldIds: [built.fields.公司名稱 ?? 0],
    })
    const { submissionId } = await publicForms.submit({
      token: share.token,
      values: { 公司名稱: "丙公司" },
      ipHash: null,
      userAgent: null,
    })
    const pending = await publicForms.getPending(tenantA, submissionId)
    expect(pending).not.toBeNull()

    const record = await records.createRecord(
      tenantA,
      built.formId,
      pending?.values as Record<string, unknown>,
      ALICE,
    )
    await publicForms.markReviewed(
      tenantA,
      submissionId,
      { status: "promoted", recordId: record.id },
      ALICE,
    )

    const inTable = await ddlKnex
      .withSchema("data")
      .table(`t${String(built.formId)}`)
      .select("*")
    expect(inTable).toHaveLength(1)
    expect(await publicForms.getPending(tenantA, submissionId)).toBeNull()
  })

  it("必填欄位缺漏會被擋", async () => {
    const built = await buildForm(tenantA, "隔離_必填", [
      { name: "公司名稱", type: "text", required: true },
    ])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "報價",
      fieldIds: [built.fields.公司名稱 ?? 0],
    })
    await expect(
      publicForms.submit({ token: share.token, values: {}, ipHash: null, userAgent: null }),
    ).rejects.toThrow(/必填/)
  })
})

describe("G-2 關閉條件與不可探測", () => {
  it("🔴 查無 token 與已關閉回**同一種訊息**(不可用試 token 探測)", async () => {
    const built = await buildForm(tenantA, "關閉_訊息", [textField("名稱")])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "x",
      fieldIds: [built.fields.名稱 ?? 0],
    })
    await publicForms.setActive(tenantA, share.id, false)

    const closed = await publicForms.resolvePublicForm(share.token).catch((e: Error) => e.message)
    const missing = await publicForms
      .resolvePublicForm("totally-made-up-token")
      .catch((e: Error) => e.message)
    expect(closed).toBe(missing)
  })

  it("🔴 達到提交上限即關閉,且計數與提交同一 tx(併發下擋得住)", async () => {
    const built = await buildForm(tenantA, "關閉_上限", [textField("名稱")])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "限額 2 筆",
      fieldIds: [built.fields.名稱 ?? 0],
      maxSubmissions: 2,
    })
    const submit = () =>
      publicForms.submit({
        token: share.token,
        values: { 名稱: "x" },
        ipHash: null,
        userAgent: null,
      })

    await submit()
    await submit()
    await expect(submit()).rejects.toThrow(/無法填寫/)

    const count = await ddlKnex("public_submission").where({ share_id: share.id }).count({ n: "*" })
    expect(Number(count[0]?.n)).toBe(2)
  })

  it("截止時間過了即關閉", async () => {
    const built = await buildForm(tenantA, "關閉_截止", [textField("名稱")])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "x",
      fieldIds: [built.fields.名稱 ?? 0],
      closesAt: new Date(Date.now() - 1000),
    })
    await expect(publicForms.resolvePublicForm(share.token)).rejects.toThrow(/無法填寫/)
  })
})

describe("G-2 租戶隔離", () => {
  it("🔴 B 租戶看不到 A 的分享設定與收件匣", async () => {
    const built = await buildForm(tenantA, "隔離_跨租戶", [textField("名稱")])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "A 專用",
      fieldIds: [built.fields.名稱 ?? 0],
    })
    await publicForms.submit({
      token: share.token,
      values: { 名稱: "A 的提交" },
      ipHash: null,
      userAgent: null,
    })

    expect((await publicForms.list(tenantB)).some((s) => s.title === "A 專用")).toBe(false)
    const inboxB = await publicForms.inbox(tenantB)
    expect(inboxB.some((s) => (s.values as Record<string, unknown>).名稱 === "A 的提交")).toBe(
      false,
    )
  })

  it("B 租戶 promote 不到 A 的提交", async () => {
    const built = await buildForm(tenantA, "隔離_跨租戶promote", [textField("名稱")])
    const share = await publicForms.create(tenantA, ALICE, {
      formId: built.formId,
      title: "x",
      fieldIds: [built.fields.名稱 ?? 0],
    })
    const { submissionId } = await publicForms.submit({
      token: share.token,
      values: { 名稱: "A 的" },
      ipHash: null,
      userAgent: null,
    })
    expect(await publicForms.getPending(tenantB, submissionId)).toBeNull()
  })
})
