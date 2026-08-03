import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PG_TEST_IMAGE } from "./pg-image.js"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { roleMembers, roles, tenants, users } from "../src/db/schema.js"

/* R1·後續-1 M2 簽核狀態機:送簽 → 金額路由(ZEN)→ 簽核推進 → 完成觸發按鈕 → 記錄鎖。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let tenantA = 0
let formId = 0
let taskFormId = 0
let buttonId = 0
let mgrRoleId = 0
let bossRoleId = 0

const A = (): Record<string, string> => ({ "x-dev-tenant": String(tenantA), "x-dev-actor": "7" })

interface InstanceDto {
  id: number
  currentStep: number
  status: string
  steps: { stepNo: number }[]
  log: { decision: string }[]
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)
  const trows = await db
    .insert(tenants)
    .values([{ name: "廠 A" }])
    .returning()
  tenantA = trows[0]?.id ?? 0
  const rrows = await db
    .insert(roles)
    .values([
      { tenantId: tenantA, key: "mgr", name: "課長", isSystem: false, depth: 0 },
      { tenantId: tenantA, key: "boss", name: "廠長", isSystem: false, depth: 0 },
    ])
    .returning()
  mgrRoleId = rrows[0]?.id ?? 0
  bossRoleId = rrows[1]?.id ?? 0

  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = container.getConnectionUri()
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "請購單",
      fields: [
        { name: "品名", type: "text", required: true },
        { name: "金額", type: "number" },
        { name: "狀態", type: "singleSelect", options: { choices: ["草稿", "已核准"] } },
      ],
    },
  })
  formId = (form.json() as { id: number }).id

  const task = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: { name: "核准後工單", fields: [{ name: "來源", type: "text", required: true }] },
  })
  taskFormId = (task.json() as { id: number }).id

  const btn = await app.inject({
    method: "POST",
    url: `/api/forms/${formId}/buttons`,
    headers: A(),
    payload: {
      label: "核准後轉工單",
      config: {
        actionType: "pushTo",
        targetFormId: taskFormId,
        fieldMap: { 來源: { from: "field", field: "品名" } },
      },
    },
  })
  buttonId = (btn.json() as { id: number }).id
})

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

const createRecord = (values: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: `/api/forms/${formId}/records`,
    headers: A(),
    payload: { values },
  })

const submit = (recordId: number) =>
  app.inject({
    method: "POST",
    url: `/api/forms/${formId}/approvals/records/${recordId}/submit`,
    headers: A(),
  })

/* 簽核者刻意用**與送簽者不同**的 actor —— 追溯稽核後禁止自簽(SOX),
   同一人送簽又核准會回 403 SELF_APPROVAL_FORBIDDEN。 */
const APPROVER = (): Record<string, string> => ({ ...A(), "x-dev-actor": "8" })

const decide = (instanceId: number, decision: "approve" | "reject") =>
  app.inject({
    method: "POST",
    url: `/api/approvals/${instanceId}/decide`,
    headers: APPROVER(),
    payload: { decision, ...(decision === "reject" ? { comment: "測試駁回" } : {}) },
  })

describe("R1·後續-1 M2 簽核狀態機", () => {
  it("建立簽核定義(兩步 + 金額條件 + 完成觸發按鈕)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/approvals/defs`,
      headers: A(),
      payload: {
        name: "請購簽核",
        steps: [
          { stepNo: 1, approverRoleId: mgrRoleId },
          { stepNo: 2, approverRoleId: bossRoleId, amountField: "金額", minAmount: 10000 },
        ],
        onCompleteButtonId: buttonId,
      },
    })
    expect(res.statusCode).toBe(201)
    expect((res.json() as { steps: unknown[] }).steps).toHaveLength(2)
  })

  it("小額(金額<門檻)→ 只走第一步 → 核准即完成 + 觸發拋轉", async () => {
    const rec = await createRecord({ 品名: "文具", 金額: 500, 狀態: "草稿" })
    const recordId = (rec.json() as { id: number }).id

    const sub = await submit(recordId)
    expect(sub.statusCode).toBe(200)
    const instance = sub.json() as InstanceDto
    expect(instance.currentStep).toBe(1)
    expect(instance.status).toBe("pending")

    const approved = await decide(instance.id, "approve")
    expect(approved.statusCode).toBe(200)
    // 第二步條件(金額>=10000)不成立 → 直接完成
    expect((approved.json() as InstanceDto).status).toBe("approved")

    // onComplete 按鈕已執行 → 目標表有記錄
    const list = await app.inject({
      method: "GET",
      url: `/api/forms/${taskFormId}/records?limit=50`,
      headers: A(),
    })
    const rows = (list.json() as { records: { values: Record<string, unknown> }[] }).records
    expect(rows.some((r) => r.values.來源 === "文具")).toBe(true)
  })

  it("大額(金額>=門檻)→ ZEN 條件啟用第二步 → 兩步才完成", async () => {
    const rec = await createRecord({ 品名: "機台", 金額: 50000, 狀態: "草稿" })
    const recordId = (rec.json() as { id: number }).id
    const instance = (await submit(recordId)).json() as InstanceDto
    expect(instance.currentStep).toBe(1)

    const afterFirst = (await decide(instance.id, "approve")).json() as InstanceDto
    expect(afterFirst.status).toBe("pending")
    expect(afterFirst.currentStep).toBe(2) // 金額條件成立 → 推進第二步

    const afterSecond = (await decide(instance.id, "approve")).json() as InstanceDto
    expect(afterSecond.status).toBe("approved")
  })

  it("簽核中記錄鎖:PATCH 被拒(409)", async () => {
    const rec = await createRecord({ 品名: "鎖定測試", 金額: 100 })
    const recordId = (rec.json() as { id: number }).id
    await submit(recordId)

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${recordId}`,
      headers: A(),
      payload: { expectedVersion: 1, values: { 品名: "偷改" } },
    })
    expect(patch.statusCode).toBe(409)
    expect((patch.json() as { code: string }).code).toBe("RECORD_LOCKED_BY_APPROVAL")
  })

  it("退回(reject)→ 狀態 rejected + 記錄解鎖可改", async () => {
    const rec = await createRecord({ 品名: "退回測試", 金額: 100 })
    const recordId = (rec.json() as { id: number }).id
    const instance = (await submit(recordId)).json() as InstanceDto

    const rejected = (await decide(instance.id, "reject")).json() as InstanceDto
    expect(rejected.status).toBe("rejected")
    expect(rejected.log.some((l) => l.decision === "reject")).toBe(true)

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/forms/${formId}/records/${recordId}`,
      headers: A(),
      payload: { expectedVersion: 1, values: { 品名: "改好了" } },
    })
    expect(patch.statusCode).toBe(200)
  })

  it("重複送簽 → 409(同記錄至多一進行中)", async () => {
    const rec = await createRecord({ 品名: "重複送簽", 金額: 100 })
    const recordId = (rec.json() as { id: number }).id
    await submit(recordId)
    const again = await submit(recordId)
    expect(again.statusCode).toBe(409)
    expect((again.json() as { code: string }).code).toBe("APPROVAL_IN_PROGRESS")
  })

  it("我的待簽:列出 pending(dev superadmin 可見全部)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/approvals/pending", headers: A() })
    expect(res.statusCode).toBe(200)
    expect((res.json() as InstanceDto[]).length).toBeGreaterThan(0)
  })

  it("撤回 → withdrawn + 解鎖", async () => {
    const rec = await createRecord({ 品名: "撤回測試", 金額: 100 })
    const recordId = (rec.json() as { id: number }).id
    const instance = (await submit(recordId)).json() as InstanceDto
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${instance.id}/withdraw`,
      headers: A(),
    })
    expect((res.json() as InstanceDto).status).toBe("withdrawn")
  })
})

describe("🔴 簽核內控補丁包(追溯稽核 #103)", () => {
  /* 送簽者固定為 actor 7(A());另備一個非送簽者 actor 供核准。 */
  const other = APPROVER

  const freshInstance = async (): Promise<number> => {
    const rec = await createRecord({ 品名: "內控測試", 金額: 500, 狀態: "草稿" })
    const recordId = (rec.json() as { id: number }).id
    const res = await submit(recordId)
    expect(res.statusCode).toBe(200)
    return (res.json() as { id: number }).id
  }

  it("**禁止自簽** —— 送簽者即使在該關角色內也不得核准自己的單(SOX)", async () => {
    const instanceId = await freshInstance()
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${instanceId}/decide`,
      headers: A(), // 同一個 actor = 送簽者
      payload: { decision: "approve" },
    })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { code: string }).code).toBe("SELF_APPROVAL_FORBIDDEN")
  })

  it("**駁回必須填理由**;填了才放行", async () => {
    const instanceId = await freshInstance()
    const bad = await app.inject({
      method: "POST",
      url: `/api/approvals/${instanceId}/decide`,
      headers: other(),
      payload: { decision: "reject" },
    })
    expect(bad.statusCode).toBe(400)
    expect((bad.json() as { code: string }).code).toBe("REJECT_REASON_REQUIRED")

    const ok = await app.inject({
      method: "POST",
      url: `/api/approvals/${instanceId}/decide`,
      headers: other(),
      payload: { decision: "reject", comment: "金額超出預算" },
    })
    expect(ok.statusCode).toBe(200)
  })

  it("**併發雙簽只有一個贏** —— 條件式 UPDATE 由 DB 保證", async () => {
    const instanceId = await freshInstance()
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/approvals/${instanceId}/decide`,
        headers: other(),
        payload: { decision: "reject", comment: "甲" },
      }),
      app.inject({
        method: "POST",
        url: `/api/approvals/${instanceId}/decide`,
        headers: other(),
        payload: { decision: "reject", comment: "乙" },
      }),
    ])
    const codes = [a.statusCode, b.statusCode].sort()
    /* 一個成功、一個落敗(409 race lost 或 409 已結束)—— 不可兩個都 200 */
    expect(codes[0]).toBe(200)
    expect(codes[1]).toBe(409)
  })

  it("**簽核歷史 append-only** —— 連表 owner 直連也不得 UPDATE / DELETE / TRUNCATE", async () => {
    const rows = await pool.query<{ n: string }>("SELECT count(*) AS n FROM approval_step_log")
    expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0)

    /* 只 REVOKE 擋不住 owner(PG:owner 恆持有 grant option)—— 這正是要 trigger 的理由。
       此處以 migration 角色(即表 owner)直連驗證。 */
    await expect(pool.query("UPDATE approval_step_log SET decision='approve'")).rejects.toThrow(
      /append-only/,
    )
    await expect(pool.query("DELETE FROM approval_step_log")).rejects.toThrow(/append-only/)
    await expect(pool.query("TRUNCATE approval_step_log")).rejects.toThrow(/append-only/)
  })

  it("**INSERT 仍正常** —— append-only 不是唯讀", async () => {
    const before = await pool.query<{ n: string }>("SELECT count(*) AS n FROM approval_step_log")
    await pool.query(
      `INSERT INTO approval_step_log (tenant_id, instance_id, step_no, actor_id, decision)
       SELECT tenant_id, instance_id, step_no, actor_id, 'submit' FROM approval_step_log LIMIT 1`,
    )
    const after = await pool.query<{ n: string }>("SELECT count(*) AS n FROM approval_step_log")
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n) + 1)
  })
})

/* 🔴 橫切 sweep:簽核鎖只掛在 PATCH/DELETE 且 url 含 /records/ 的路由上,
   而**按鈕本來就是設計來改記錄的**,走的是另一條路由形狀 → 完全不受保護。
   這是本 session 第三次踩到同一類問題(選項繞道 /type、匯入繞過鎖)。 */
describe("🔴 簽核鎖的路由涵蓋(橫切 sweep)", () => {
  it("**按鈕不得繞過簽核鎖**", async () => {
    const rec = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/records`,
      headers: A(),
      payload: { values: { 品名: "鎖測試", 金額: 10 } },
    })
    const recordId = (rec.json() as { id: number }).id

    const def = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/approvals/defs`,
      headers: A(),
      payload: { name: "鎖測試流程", steps: [{ stepNo: 1, approverRoleId: null }] },
    })
    const defId = (def.json() as { id: number }).id

    const submitted = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/approvals/records/${recordId}/submit`,
      headers: A(),
      payload: { defId },
    })
    // 送簽本身不被鎖擋 —— 當下還沒有進行中的簽核
    expect(submitted.statusCode).toBeLessThan(400)

    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/buttons/${buttonId}/run/${recordId}`,
      headers: A(),
    })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { code: string }).code).toBe("RECORD_LOCKED_BY_APPROVAL")
  })
})

/* 🔴 #104|簽核代理人。沒有代理時,簽核者一請假,經過他的單據就**全部卡死** ——
   而請假是常態不是例外。台灣企業的「職務代理人」是內控慣例,
   Ragic(啟用及通知代理人)/ Salesforce(Delegated Approver)/ SAP(計畫性代理)三家都有。

   🔴 這組測試一律送 `x-dev-real-authz: 1` —— dev 預設 isSuperAdmin,
   代理路徑會被第一行的 super admin 捷徑整個跳過,測了等於沒測。 */
describe("🔴 簽核代理人", () => {
  /* principal 在 mgr 角色內(真正的簽核者);delegate 不在任何角色內 —— 
     否則代理有沒有生效根本測不出來 */
  let principal = 0
  let delegate = 0

  const REAL = (actorId: number): Record<string, string> => ({
    "x-dev-tenant": String(tenantA),
    "x-dev-actor": String(actorId),
    "x-dev-real-authz": "1",
  })

  beforeAll(async () => {
    const db = createDrizzle(pool)
    const u = await db
      .insert(users)
      .values([
        { authUserId: "auth-principal", email: "principal@weyver.test", name: "課長本人" },
        { authUserId: "auth-delegate", email: "delegate@weyver.test", name: "代理人" },
      ])
      .returning()
    principal = u[0]?.id ?? 0
    delegate = u[1]?.id ?? 0
    await db
      .insert(roleMembers)
      .values([{ tenantId: tenantA, roleId: mgrRoleId, actorId: principal }])
  })

  const grantDelegate = async (
    principalId: number,
    delegateId: number,
    endsAt: string | null = null,
  ): Promise<void> => {
    await pool.query("DELETE FROM approval_delegate WHERE tenant_id = $1", [tenantA])
    await pool.query(
      `INSERT INTO approval_delegate (tenant_id, principal_actor_id, delegate_actor_id, starts_at, ends_at)
       VALUES ($1, $2, $3, now() - interval '1 day', $4)`,
      [tenantA, principalId, delegateId, endsAt],
    )
  }

  const submitFresh = async (): Promise<number> => {
    const rec = await createRecord({ 品名: "代理測試", 金額: 100 })
    const recordId = (rec.json() as { id: number }).id
    return ((await submit(recordId)).json() as InstanceDto).id
  }

  const approveAs = (instanceId: number, actorId: number) =>
    app.inject({
      method: "POST",
      url: `/api/approvals/${instanceId}/decide`,
      headers: REAL(actorId),
      payload: { decision: "approve" },
    })

  const lastLog = async (instanceId: number): Promise<Record<string, string | null>> => {
    const r = await pool.query<{ actor_id: string; on_behalf_of_actor_id: string | null }>(
      `SELECT actor_id, on_behalf_of_actor_id FROM approval_step_log
        WHERE instance_id = $1 AND decision = 'approve' ORDER BY id DESC LIMIT 1`,
      [instanceId],
    )
    return r.rows[0] ?? {}
  }

  it("🔴 基準:在角色內的人簽得了,且不記為代理", async () => {
    const id = await submitFresh()
    await pool.query("DELETE FROM approval_delegate WHERE tenant_id = $1", [tenantA])
    expect((await approveAs(id, principal)).statusCode).toBe(200)
    /* 本人親自核准**不得**被記成代理 —— 否則稽核會看到一堆不存在的代理行為 */
    expect((await lastLog(id)).on_behalf_of_actor_id).toBeNull()
  })

  it("🔴 沒有代理關係時,不在角色內的人簽不了", async () => {
    const id = await submitFresh()
    await pool.query("DELETE FROM approval_delegate WHERE tenant_id = $1", [tenantA])
    expect((await approveAs(id, delegate)).statusCode).toBe(403)
  })

  it("🔴 有有效代理時簽得了,且**稽核記下代的是誰**", async () => {
    const id = await submitFresh()
    await grantDelegate(principal, delegate)
    expect((await approveAs(id, delegate)).statusCode).toBe(200)

    /* 只記「代理人核准」的話,代理在事後完全看不見 ——
       稽核無法回答「為什麼是他批的?他有什麼權?」 */
    const log = await lastLog(id)
    expect(Number(log.actor_id)).toBe(delegate)
    expect(Number(log.on_behalf_of_actor_id)).toBe(principal)
  })

  /* 🔴 「簽得了但找不到」= 代理只做了一半。API 放行、待簽匣沒有那一筆的話,
     代理人根本不知道有東西等他處理。 */
  it("🔴 代理來的單據要出現在待簽匣裡", async () => {
    const id = await submitFresh()
    await pool.query("DELETE FROM approval_delegate WHERE tenant_id = $1", [tenantA])
    const before = await app.inject({
      method: "GET",
      url: "/api/approvals/pending",
      headers: REAL(delegate),
    })
    expect((before.json() as { id: number }[]).some((i) => i.id === id)).toBe(false)

    await grantDelegate(principal, delegate)
    const after = await app.inject({
      method: "GET",
      url: "/api/approvals/pending",
      headers: REAL(delegate),
    })
    expect((after.json() as { id: number }[]).some((i) => i.id === id)).toBe(true)
  })

  it("🔴 代理期間已過就失效 —— 請假結束自動收回,不必記得手動關", async () => {
    const id = await submitFresh()
    await grantDelegate(principal, delegate, new Date(Date.now() - 3_600_000).toISOString())
    expect((await approveAs(id, delegate)).statusCode).toBe(403)
  })

  it("🔴 代理尚未開始也不生效", async () => {
    const id = await submitFresh()
    await pool.query("DELETE FROM approval_delegate WHERE tenant_id = $1", [tenantA])
    await pool.query(
      `INSERT INTO approval_delegate (tenant_id, principal_actor_id, delegate_actor_id, starts_at)
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      [tenantA, principal, delegate],
    )
    expect((await approveAs(id, delegate)).statusCode).toBe(403)
  })

  /* 🔴 代理不得成為繞過禁自簽的側門:送簽者拿到代理權也不能簽自己的單 */
  it("🔴 代理不得繞過禁自簽", async () => {
    const rec = await createRecord({ 品名: "自簽測試", 金額: 100 })
    const recordId = (rec.json() as { id: number }).id
    /* 用 principal 送簽,再讓 principal 以「代理」身分簽同一張。
       送簽這一步不送 real-authz —— 這裡要驗的是禁自簽,不是送簽端的表單權限。 */
    const sub = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/approvals/records/${recordId}/submit`,
      headers: { ...A(), "x-dev-actor": String(principal) },
    })
    const id = (sub.json() as InstanceDto).id
    await grantDelegate(delegate, principal)
    const res = await approveAs(id, principal)
    expect(res.statusCode).toBe(403)
    expect((res.json() as { code: string }).code).toBe("SELF_APPROVAL_FORBIDDEN")
  })

  /* 🔴 代理不遞移:代理人的代理人**不會**繼承到最上游的簽核權。
     代理鏈會讓「這張單到底誰能簽」變成沒人算得出來的問題。 */
  it("🔴 代理不遞移(A 代 B、B 代 C ≠ A 可簽 C 的關卡)", async () => {
    const id = await submitFresh()
    const db = createDrizzle(pool)
    const third = (
      await db
        .insert(users)
        .values({ authUserId: "auth-third", email: "third@weyver.test", name: "第三人" })
        .returning()
    )[0]?.id
    expect(third).toBeDefined()
    await pool.query("DELETE FROM approval_delegate WHERE tenant_id = $1", [tenantA])
    /* principal(有角色)→ delegate → third */
    await pool.query(
      `INSERT INTO approval_delegate (tenant_id, principal_actor_id, delegate_actor_id)
       VALUES ($1, $2, $3), ($1, $3, $4)`,
      [tenantA, principal, delegate, third],
    )
    expect((await approveAs(id, third ?? 0)).statusCode).toBe(403)
  })

  /* 🔴 DB 層擋住「代理自己」—— 那不是代理,是無意義的自我授權 */
  it("🔴 不得把自己設為自己的代理", async () => {
    await expect(
      pool.query(
        `INSERT INTO approval_delegate (tenant_id, principal_actor_id, delegate_actor_id)
         VALUES ($1, $2, $2)`,
        [tenantA, principal],
      ),
    ).rejects.toThrow(/approval_delegate_not_self/)
  })
})

/* #104 代理人的自助設定 API。權責邊界比 CRUD 本身重要 —— 代理是一種授權轉移。 */
describe("🔴 簽核代理人 API(自助設定)", () => {
  let alpha = 0
  let beta = 0

  const AS = (actorId: number): Record<string, string> => ({
    "x-dev-tenant": String(tenantA),
    "x-dev-actor": String(actorId),
    "x-dev-real-authz": "1",
  })

  beforeAll(async () => {
    const db = createDrizzle(pool)
    const u = await db
      .insert(users)
      .values([
        { authUserId: "auth-alpha", email: "alpha@weyver.test", name: "甲" },
        { authUserId: "auth-beta", email: "beta@weyver.test", name: "乙" },
      ])
      .returning()
    alpha = u[0]?.id ?? 0
    beta = u[1]?.id ?? 0
  })

  const create = (actorId: number, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/approval-delegates", headers: AS(actorId), payload })

  it("設定自己的代理人,兩邊都看得到", async () => {
    const res = await create(alpha, { delegateActorId: beta })
    expect(res.statusCode).toBe(201)
    expect((res.json() as { active: boolean }).active).toBe(true)

    const mine = await app.inject({
      method: "GET",
      url: "/api/approval-delegates",
      headers: AS(alpha),
    })
    expect((mine.json() as { granted: unknown[] }).granted).toHaveLength(1)

    /* 🔴 代理人自己也要看得到 —— 否則簽核匣多出別人的單會像系統出錯 */
    const theirs = await app.inject({
      method: "GET",
      url: "/api/approval-delegates",
      headers: AS(beta),
    })
    expect(
      (theirs.json() as { received: { principalActorId: number }[] }).received[0]?.principalActorId,
    ).toBe(alpha)
  })

  it("🔴 不得替別人設定代理(非 admin)", async () => {
    const res = await create(beta, { principalActorId: alpha, delegateActorId: beta })
    expect(res.statusCode).toBe(403)
    expect((res.json() as { code: string }).code).toBe("DELEGATE_FORBIDDEN")
  })

  it("🔴 代理人不得自行解除 —— 授權的一端必須留在授權者手上", async () => {
    const created = await create(alpha, { delegateActorId: beta })
    const id = (created.json() as { id: number }).id
    const byDelegate = await app.inject({
      method: "DELETE",
      url: `/api/approval-delegates/${id}`,
      headers: AS(beta),
    })
    expect(byDelegate.statusCode).toBe(403)

    const byPrincipal = await app.inject({
      method: "DELETE",
      url: `/api/approval-delegates/${id}`,
      headers: AS(alpha),
    })
    expect(byPrincipal.statusCode).toBe(204)
  })

  it("代理人不可以是本人 / 結束早於開始", async () => {
    expect((await create(alpha, { delegateActorId: alpha })).statusCode).toBe(400)
    const bad = await create(alpha, {
      delegateActorId: beta,
      startsAt: "2026-08-10T00:00:00.000Z",
      endsAt: "2026-08-01T00:00:00.000Z",
    })
    expect(bad.statusCode).toBe(400)
    expect((bad.json() as { code: string }).code).toBe("DELEGATE_RANGE")
  })
})

/* 🔴 OQ-AP2-9|簽核紀錄 hash chain(0021 明列的「偵測層」)。

   0021 已做完**防護層**(no_mutate trigger + REVOKE + event trigger 擋 DROP),
   但它自己誠實寫著擋不住 superuser。這一組測的是另一半:**擋不住,但證明得出來**。

   ⚠️ 這些測試刻意用**特權連線**去竄改 —— 那正是威脅模型裡防不住的那個角色。
   用 app 車道改根本改不動(0021 已保證),那樣測等於什麼都沒驗。 */
describe("🔴 簽核紀錄 hash chain(可偵測竄改)", () => {
  const chainOf = async (instanceId: number) =>
    (
      await pool.query<{ id: string; hash: string | null; prev_hash: string | null }>(
        "SELECT id, hash, prev_hash FROM approval_step_log WHERE instance_id = $1 ORDER BY id",
        [instanceId],
      )
    ).rows

  const breaks = async () =>
    (
      await pool.query<{ log_id: string; reason: string }>(
        "SELECT log_id, reason FROM approval_log_chain_breaks($1)",
        [tenantA],
      )
    ).rows

  const newInstance = async (): Promise<number> => {
    const rec = await createRecord({ 品名: "鏈測試", 金額: 500, 狀態: "草稿" })
    const res = await submit((rec.json() as { id: number }).id)
    return (res.json() as { id: number }).id
  }

  it("每一筆 log 都被串進鏈:第一筆 prev 為空,後續接上前一筆", async () => {
    const instanceId = await newInstance()
    await decide(instanceId, "approve")
    const rows = await chainOf(instanceId)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0]?.prev_hash).toBeNull()
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]?.prev_hash).toBe(rows[i - 1]?.hash)
    }
  })

  it("乾淨的資料不得回報任何斷點(否則報告是恆紅的假警報)", async () => {
    await newInstance()
    expect(await breaks()).toEqual([])
  })

  /* 🔴 這一條是整個機制的重點:內容被改過就驗得出來。
     用特權連線改 —— app 車道改不動是 0021 的事,這裡測的是「改成功之後怎麼辦」。 */
  it("🔴 改掉某一列的內容 → 報告指出那一列 tampered", async () => {
    const instanceId = await newInstance()
    await decide(instanceId, "approve")
    const rows = await chainOf(instanceId)
    const victim = Number(rows[0]?.id)

    /* trigger 擋 UPDATE,故先停用再改 —— 模擬「握有特權的人動了手腳」 */
    await pool.query("ALTER TABLE approval_step_log DISABLE TRIGGER no_mutate")
    await pool.query("UPDATE approval_step_log SET comment = $1 WHERE id = $2", [
      "被竄改的理由",
      victim,
    ])
    await pool.query("ALTER TABLE approval_step_log ENABLE ALWAYS TRIGGER no_mutate")

    const found = await breaks()
    expect(found.some((b) => Number(b.log_id) === victim && b.reason === "tampered")).toBe(true)
  })

  it("🔴 抽掉一列 → 它的後繼者因為接不上而被指出 unlinked", async () => {
    const instanceId = await newInstance()
    await decide(instanceId, "approve")
    const rows = await chainOf(instanceId)
    /* 🔴 必須抽**有後繼者**的那一列。抽最後一列驗不出東西 ——
       沒有人需要接上它,鏈自然不會斷(第一版就是這樣紅的:兩列時
       `floor(2/2)` 正好指到最後一列)。 */
    expect(rows.length).toBeGreaterThanOrEqual(2)
    const victim = Number(rows[0]?.id)

    await pool.query("ALTER TABLE approval_step_log DISABLE TRIGGER no_mutate")
    await pool.query("DELETE FROM approval_step_log WHERE id = $1", [victim])
    await pool.query("ALTER TABLE approval_step_log ENABLE ALWAYS TRIGGER no_mutate")

    const found = await breaks()
    expect(found.some((b) => b.reason === "unlinked")).toBe(true)
  })

  it("報告端點限管理員,且回傳結構含檢查時間(稽核要答得出「什麼時候查的」)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/approvals/chain-report",
      headers: A(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { breaks: unknown[]; checkedAt: string }
    expect(Array.isArray(body.breaks)).toBe(true)
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false)
  })
})
