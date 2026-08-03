import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { roleMembers, roles, tenants, users } from "../src/db/schema.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

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
/* 🔴 送簽者與簽核者是**真的 users 列 + 真的 role_members**,不是憑空的數字 actor id。
   原本兩者是寫死的 "7" / "8",而角色**從來沒有加成員** —— 測試之所以會過,
   是因為 dev 車道一律 superAdmin,`approverOf` 第一行就放行了,
   角色成員這條路從頭到尾沒被走過(順帶製造了滿版的 notification FK 錯誤日誌)。
   動態簽核人上線後「這一關到底有沒有人簽得了」變成真問題,fixture 必須是真的。 */
let submitterId = 0
let approverId = 0

const A = (): Record<string, string> => ({
  "x-dev-tenant": String(tenantA),
  "x-dev-actor": String(submitterId),
})

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

  const urows = await db
    .insert(users)
    .values([
      { authUserId: "auth-submitter", email: "submitter@weyver.test", name: "送簽者" },
      { authUserId: "auth-approver", email: "approver@weyver.test", name: "簽核者" },
    ])
    .returning()
  submitterId = urows[0]?.id ?? 0
  approverId = urows[1]?.id ?? 0
  /* 送簽者**也**放進 mgr —— 「禁止自簽」要證明的正是「即使你在該關角色內也不准簽自己的單」,
     他不在角色裡的話那條測試就變成在測角色檢查,不是在測自簽防護。 */
  await db.insert(roleMembers).values([
    { tenantId: tenantA, roleId: mgrRoleId, actorId: submitterId },
    { tenantId: tenantA, roleId: mgrRoleId, actorId: approverId },
    { tenantId: tenantA, roleId: bossRoleId, actorId: approverId },
  ])

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
const APPROVER = (): Record<string, string> => ({ ...A(), "x-dev-actor": String(approverId) })

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

/* 🔴 OQ-AP2-1 / OQ-AP2-2|動態簽核人解析(直屬主管)。

   對齊 Ragic 官方的三種解析,但**主管由 role tree 推導**而非另存一份組織關係
   —— 兩份組織結構必然分岔(「權限樹改了、簽核流沒跟著改」)。
   誠實代價:這裡的「主管」是一組人不是一個人。 */
describe("🔴 動態簽核人(直屬主管,由 role tree 推導)", () => {
  let staffRoleId = 0
  let staffId = 0
  let lonerRoleId = 0
  let lonerId = 0
  let dynFormId = 0

  const AS_ACTOR = (actorId: number): Record<string, string> => ({
    "x-dev-tenant": String(tenantA),
    "x-dev-actor": String(actorId),
  })

  beforeAll(async () => {
    const db = createDrizzle(pool)
    const r = await db
      .insert(roles)
      .values([
        /* 課員掛在課長底下 → 課員的「直屬主管」= 課長角色的成員 */
        { tenantId: tenantA, key: "staff", name: "課員", parentId: mgrRoleId, depth: 1 },
        /* 沒有父角色 → 解析不出主管,用來驗硬失敗 */
        { tenantId: tenantA, key: "loner", name: "無主管部門", depth: 0 },
      ])
      .returning()
    staffRoleId = r[0]?.id ?? 0
    lonerRoleId = r[1]?.id ?? 0
    const u = await db
      .insert(users)
      .values([
        { authUserId: "auth-staff", email: "staff@weyver.test", name: "課員" },
        { authUserId: "auth-loner", email: "loner@weyver.test", name: "沒有主管的人" },
      ])
      .returning()
    staffId = u[0]?.id ?? 0
    lonerId = u[1]?.id ?? 0
    await db.insert(roleMembers).values([
      { tenantId: tenantA, roleId: staffRoleId, actorId: staffId },
      { tenantId: tenantA, roleId: lonerRoleId, actorId: lonerId },
    ])

    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: "動態簽核表", fields: [{ name: "品名", type: "text" }] },
    })
    dynFormId = (form.json() as { id: number }).id
    const def = await app.inject({
      method: "POST",
      url: `/api/forms/${String(dynFormId)}/approvals/defs`,
      headers: A(),
      payload: { name: "送主管", steps: [{ stepNo: 1, approverRule: "manager" }] },
    })
    expect(def.statusCode).toBe(201)
  })

  const submitAs = async (actorId: number) => {
    const rec = await app.inject({
      method: "POST",
      url: `/api/forms/${String(dynFormId)}/records`,
      headers: AS_ACTOR(actorId),
      payload: { values: { 品名: "動態測試" } },
    })
    return app.inject({
      method: "POST",
      url: `/api/forms/${String(dynFormId)}/approvals/records/${String((rec.json() as { id: number }).id)}/submit`,
      headers: AS_ACTOR(actorId),
    })
  }

  it("課員送簽 → 解析到課長角色的成員,而不是要求指定角色", async () => {
    const res = await submitAs(staffId)
    expect(res.statusCode).toBe(200)
    expect((res.json() as { currentStep: number }).currentStep).toBe(1)
  })

  /* 🔴 這條是動態簽核人**真的有用**的證明:沒有它,「送給直屬主管」的單子
     永遠不會出現在主管的待簽匣裡,功能等於不存在。 */
  it("🔴 該單出現在主管的待簽匣(靜態角色比對抓不到動態關卡)", async () => {
    await submitAs(staffId)
    const pending = await app.inject({
      method: "GET",
      url: "/api/approvals/pending",
      headers: { ...AS_ACTOR(approverId), "x-dev-real-authz": "1" },
    })
    expect(pending.statusCode).toBe(200)
    expect((pending.json() as unknown[]).length).toBeGreaterThan(0)
  })

  /* 🔴 OQ-AP2-2|業界一致硬失敗。但 Salesforce 是**簽核人回應時**才炸,
     那時單子已經走到一半;我方改在送簽當下就擋,而且要指名是哪一關。 */
  it("🔴 解析不出主管 → 送簽當下就擋,訊息指名是哪一關", async () => {
    const res = await submitAs(lonerId)
    expect(res.statusCode).toBe(422)
    const body = res.json() as { code: string; message: string }
    expect(body.code).toBe("APPROVER_UNRESOLVED")
    expect(body.message).toContain("第 1 關")
  })
})

/* 🔴 OQ-AP2-9 = C|`fieldRef`:簽核人 = 這筆記錄上某個 member 欄位所指的人。

   為 Ragic 遷移而生 —— Ragic 的「直屬主管」本來就住在表單的欄位裡,
   此規則讓它原地留著,遷移轉換退化成「指定是哪一欄」。 */
describe("🔴 依欄位指定簽核人(Ragic 主管欄遷移)", () => {
  let frFormId = 0
  let frSubmitter = 0
  let frBoss = 0

  const AS = (actorId: number): Record<string, string> => ({
    "x-dev-tenant": String(tenantA),
    "x-dev-actor": String(actorId),
  })

  beforeAll(async () => {
    const db = createDrizzle(pool)
    const u = await db
      .insert(users)
      .values([
        { authUserId: "auth-fr-sub", email: "frsub@weyver.test", name: "申請人" },
        { authUserId: "auth-fr-boss", email: "frboss@weyver.test", name: "指定主管" },
      ])
      .returning()
    frSubmitter = u[0]?.id ?? 0
    frBoss = u[1]?.id ?? 0

    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: {
        name: "請購單_欄位簽核",
        fields: [
          { name: "品名", type: "text" },
          { name: "主管", type: "member" },
        ],
      },
    })
    frFormId = (form.json() as { id: number }).id
    const def = await app.inject({
      method: "POST",
      url: `/api/forms/${String(frFormId)}/approvals/defs`,
      headers: A(),
      payload: {
        name: "送欄位上的主管",
        steps: [{ stepNo: 1, approverRule: "fieldRef", approverField: "主管" }],
      },
    })
    expect(def.statusCode).toBe(201)
  })

  const submitWith = async (boss: number | null) => {
    const rec = await app.inject({
      method: "POST",
      url: `/api/forms/${String(frFormId)}/records`,
      headers: AS(frSubmitter),
      payload: { values: { 品名: "文具", 主管: boss } },
    })
    return app.inject({
      method: "POST",
      url: `/api/forms/${String(frFormId)}/approvals/records/${String((rec.json() as { id: number }).id)}/submit`,
      headers: AS(frSubmitter),
    })
  }

  it("欄位指到誰,誰就是這一關的簽核人", async () => {
    const res = await submitWith(frBoss)
    expect(res.statusCode).toBe(200)
    const pending = await app.inject({
      method: "GET",
      url: "/api/approvals/pending",
      headers: { ...AS(frBoss), "x-dev-real-authz": "1" },
    })
    expect((pending.json() as unknown[]).length).toBeGreaterThan(0)
  })

  /* 🔴 這是 fieldRef **最大的風險**:申請人可以自己改那個欄位。
     把主管改成自己就等於自簽核可。送簽當下必須擋,不能等單子走到一半。
     (真正的緩解是把該欄以 E-1 設為申請人唯讀,但那是設定,程式這一層也要守。) */
  it("🔴 欄位指到申請人自己 → 送簽當下就擋,不得自簽", async () => {
    const res = await submitWith(frSubmitter)
    expect(res.statusCode).toBe(422)
    const body = res.json() as { code: string; message: string }
    expect(body.code).toBe("APPROVER_UNRESOLVED")
    expect(body.message).toContain("本人")
  })

  /* 欄位沒填 → 解析不出人。**絕不靜默跳過該關** —— 跳過一關簽核是權限事故。 */
  it("🔴 欄位為空 → 送簽被擋並指名是哪一關,不靜默跳關", async () => {
    const res = await submitWith(null)
    expect(res.statusCode).toBe(422)
    expect((res.json() as { message: string }).message).toContain("第 1 關")
  })
})

/* 🔴 OQ-AP2-3 / OQ-AP2-4 / OQ-AP2-5|會簽(N-of-M)與臨時加簽。 */
describe("🔴 會簽 / 擇辦與臨時加簽", () => {
  let coFormId = 0
  let memberA = 0
  let memberB = 0
  let coRoleId = 0

  const AS = (actorId: number): Record<string, string> => ({
    "x-dev-tenant": String(tenantA),
    "x-dev-actor": String(actorId),
  })

  beforeAll(async () => {
    const db = createDrizzle(pool)
    const r = await db
      .insert(roles)
      .values([{ tenantId: tenantA, key: "qa", name: "品保", depth: 0 }])
      .returning()
    coRoleId = r[0]?.id ?? 0
    const u = await db
      .insert(users)
      .values([
        { authUserId: "auth-co-a", email: "coa@weyver.test", name: "會簽甲" },
        { authUserId: "auth-co-b", email: "cob@weyver.test", name: "會簽乙" },
      ])
      .returning()
    memberA = u[0]?.id ?? 0
    memberB = u[1]?.id ?? 0
    await db.insert(roleMembers).values([
      { tenantId: tenantA, roleId: coRoleId, actorId: memberA },
      { tenantId: tenantA, roleId: coRoleId, actorId: memberB },
    ])

    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: "會簽表", fields: [{ name: "品名", type: "text" }] },
    })
    coFormId = (form.json() as { id: number }).id
  })

  /* 🔴 每個案例用**自己的表單**。同一張表上建第二個 active def 之後,
     送簽會挑到最早的那個(`defs.find(d => d.active)`)—— 第一版就是這樣紅的,
     而症狀是「擇辦設了 quorum=1 卻還要兩個人簽」,看起來像 quorum 壞掉。 */
  const defWith = async (step: Record<string, unknown>): Promise<void> => {
    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: `會簽表${String(Date.now())}`, fields: [{ name: "品名", type: "text" }] },
    })
    coFormId = (form.json() as { id: number }).id
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(coFormId)}/approvals/defs`,
      headers: A(),
      payload: { name: "流程", steps: [{ stepNo: 1, ...step }] },
    })
    expect(res.statusCode).toBe(201)
  }

  const submitOne = async (): Promise<number> => {
    const rec = await app.inject({
      method: "POST",
      url: `/api/forms/${String(coFormId)}/records`,
      headers: A(),
      payload: { values: { 品名: "會簽測試" } },
    })
    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${String(coFormId)}/approvals/records/${String((rec.json() as { id: number }).id)}/submit`,
      headers: A(),
    })
    expect(res.statusCode).toBe(200)
    return (res.json() as { id: number }).id
  }

  const decideAs = (actorId: number, instanceId: number, decision: "approve" | "reject") =>
    app.inject({
      method: "POST",
      url: `/api/approvals/${String(instanceId)}/decide`,
      headers: { ...AS(actorId), "x-dev-real-authz": "1" },
      payload: { decision, ...(decision === "reject" ? { comment: "不同意" } : {}) },
    })

  it("🔴 會簽(quorum: all):一人核准還不算過,兩人到齊才推進", async () => {
    await defWith({ approverRoleId: coRoleId, quorum: "all" })
    const instanceId = await submitOne()

    const first = await decideAs(memberA, instanceId, "approve")
    expect(first.statusCode).toBe(200)
    /* 🔴 這一條是會簽的核心:一個人簽完**還在原地**,不是已核准 */
    expect((first.json() as { status: string }).status).toBe("pending")

    const second = await decideAs(memberB, instanceId, "approve")
    expect((second.json() as { status: string }).status).toBe("approved")
  })

  it("未填 quorum = 任一人即可(既有行為不得因本批而改變)", async () => {
    await defWith({ approverRoleId: coRoleId })
    const instanceId = await submitOne()
    const only = await decideAs(memberA, instanceId, "approve")
    expect((only.json() as { status: string }).status).toBe("approved")
  })

  /* Power Automate 官方逐字:「run after all the approvers respond,
   **or when a single rejection occurs**」—— 不等其他人。 */
  it("🔴 會簽中有人拒絕 → 立刻整單否決,不等其他人", async () => {
    await defWith({ approverRoleId: coRoleId, quorum: "all" })
    const instanceId = await submitOne()
    await decideAs(memberA, instanceId, "approve")
    const no = await decideAs(memberB, instanceId, "reject")
    expect((no.json() as { status: string }).status).toBe("rejected")
  })

  it("🔴 臨時加簽:被加的人才簽得了,且加簽本身進 append-only log", async () => {
    await defWith({ approverRoleId: coRoleId, quorum: 1 })
    const instanceId = await submitOne()

    /* 加簽前:局外人簽不了 */
    const before = await decideAs(approverId, instanceId, "approve")
    expect(before.statusCode).toBe(403)

    const add = await app.inject({
      method: "POST",
      url: `/api/approvals/${String(instanceId)}/add-approver`,
      headers: { ...AS(memberA), "x-dev-real-authz": "1" },
      payload: { actorId: approverId },
    })
    expect(add.statusCode).toBe(200)

    const after = await decideAs(approverId, instanceId, "approve")
    expect((after.json() as { status: string }).status).toBe("approved")

    const logged = await pool.query(
      "SELECT actor_id, added_by_actor_id FROM approval_step_log WHERE instance_id = $1 AND decision = 'addApprover'",
      [instanceId],
    )
    /* 被加的人與加人的人分開存 —— 只記一個的話,事後看不出是誰擴大了簽核圈 */
    expect(Number(logged.rows[0]?.actor_id)).toBe(approverId)
    expect(Number(logged.rows[0]?.added_by_actor_id)).toBe(memberA)
  })

  it("🔴 不得把送簽者本人加為簽核人(那是自簽禁令的後門)", async () => {
    await defWith({ approverRoleId: coRoleId, quorum: 1 })
    const instanceId = await submitOne()
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${String(instanceId)}/add-approver`,
      headers: { ...AS(memberA), "x-dev-real-authz": "1" },
      payload: { actorId: submitterId },
    })
    expect(res.statusCode).toBe(422)
    expect((res.json() as { code: string }).code).toBe("SELF_APPROVAL_FORBIDDEN")
  })
})

/* 🔴 OQ-AP2-6/7/8|退回到指定關 · OQ-AP2-10|鎖定逃生路徑。 */
describe("🔴 退回到指定關與鎖定逃生", () => {
  let rFormId = 0
  let rRecordId = 0

  const mkInstance = async (steps: Record<string, unknown>[]): Promise<number> => {
    const form = await app.inject({
      method: "POST",
      url: "/api/forms",
      headers: A(),
      payload: { name: `退回表${String(Date.now())}`, fields: [{ name: "品名", type: "text" }] },
    })
    rFormId = (form.json() as { id: number }).id
    const def = await app.inject({
      method: "POST",
      url: `/api/forms/${String(rFormId)}/approvals/defs`,
      headers: A(),
      payload: { name: "多關流程", steps },
    })
    expect(def.statusCode).toBe(201)
    const rec = await app.inject({
      method: "POST",
      url: `/api/forms/${String(rFormId)}/records`,
      headers: A(),
      payload: { values: { 品名: "退回測試" } },
    })
    rRecordId = (rec.json() as { id: number }).id
    const sub = await app.inject({
      method: "POST",
      url: `/api/forms/${String(rFormId)}/approvals/records/${String(rRecordId)}/submit`,
      headers: A(),
    })
    expect(sub.statusCode).toBe(200)
    return (sub.json() as { id: number }).id
  }

  /* 🔴 必須是**函式**。寫成 const 陣列的話,它在 describe 註冊當下就求值,
     而那時 `mgrRoleId` 還是 0(beforeAll 尚未跑)→ 建定義時 400,
     症狀看起來像 schema 壞掉。 */
  const threeSteps = (): Record<string, unknown>[] => [
    { stepNo: 1, approverRoleId: mgrRoleId, quorum: 1 },
    { stepNo: 2, approverRoleId: bossRoleId, quorum: 1 },
    { stepNo: 3, approverRoleId: bossRoleId, quorum: 1 },
  ]

  const approve = (instanceId: number) =>
    app.inject({
      method: "POST",
      url: `/api/approvals/${String(instanceId)}/decide`,
      headers: APPROVER(),
      payload: { decision: "approve" },
    })

  const returnTo = (instanceId: number, targetStep: number) =>
    app.inject({
      method: "POST",
      url: `/api/approvals/${String(instanceId)}/return`,
      headers: APPROVER(),
      payload: { targetStep, comment: "品名寫錯,請修正後再送" },
    })

  it("🔴 第 3 關可以直接退回第 1 關,不是只能退一關", async () => {
    const instanceId = await mkInstance(threeSteps())
    await approve(instanceId)
    const atThird = await approve(instanceId)
    expect((atThird.json() as { currentStep: number }).currentStep).toBe(3)

    const res = await returnTo(instanceId, 1)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { currentStep: number; status: string }
    expect(body.currentStep).toBe(1)
    /* 退回不是駁回 —— 單子還活著 */
    expect(body.status).toBe("pending")
  })

  /* 🔴 這一條是 OQ-AP2-8 的核心。少了它,退回到第 1 關之後,
     第 2 關會因為**上一輪的核准**而直接通過 —— 那一關的內控等於被跳過。 */
  it("🔴 退回後從目標關全部重簽:舊的核准不再算數", async () => {
    const instanceId = await mkInstance(threeSteps())
    await approve(instanceId) // 過第 1 關
    await approve(instanceId) // 過第 2 關 → 現在在第 3 關
    await returnTo(instanceId, 1)

    const again = await approve(instanceId) // 重簽第 1 關
    /* 若舊核准仍算數,這一下會一路衝到 approved */
    expect((again.json() as { currentStep: number; status: string }).currentStep).toBe(2)
    expect((again.json() as { status: string }).status).toBe("pending")
  })

  it("退回目標可用 returnableTo 收窄,超出範圍要說得出可退哪幾關", async () => {
    const instanceId = await mkInstance([
      { stepNo: 1, approverRoleId: mgrRoleId, quorum: 1 },
      { stepNo: 2, approverRoleId: bossRoleId, quorum: 1 },
      { stepNo: 3, approverRoleId: bossRoleId, quorum: 1, returnableTo: [2] },
    ])
    await approve(instanceId)
    await approve(instanceId)
    const bad = await returnTo(instanceId, 1)
    expect(bad.statusCode).toBe(422)
    expect((bad.json() as { code: string }).code).toBe("RETURN_TARGET_NOT_ALLOWED")
    expect((bad.json() as { message: string }).message).toContain("第 2 關")

    const ok = await returnTo(instanceId, 2)
    expect(ok.statusCode).toBe(200)
  })

  it("退回必須填理由;不得往前退", async () => {
    const instanceId = await mkInstance(threeSteps())
    const noReason = await app.inject({
      method: "POST",
      url: `/api/approvals/${String(instanceId)}/return`,
      headers: APPROVER(),
      payload: { targetStep: 1, comment: "" },
    })
    expect(noReason.statusCode).toBe(400)

    /* 現在在第 1 關,退回第 1 關等於原地打轉 */
    const forward = await returnTo(instanceId, 1)
    expect(forward.statusCode).toBe(422)
    expect((forward.json() as { code: string }).code).toBe("INVALID_RETURN_TARGET")
  })

  /* 🔴 OQ-AP2-10|沒有這些逃生路徑,簽核人一離職記錄就永久鎖死,
     唯一的解是作廢整個簽核重來 —— 連帶丟掉已簽關卡的稽核意義。 */
  /* 🔴 **admin 也改不動** —— 逃生路徑是顯式解鎖而非靜默 bypass。
     多一個動作,換到一筆答得出「誰、什麼時候、為什麼」的紀錄。 */
  it("🔴 簽核中連管理員都改不動;強制解鎖後才改得動,且解鎖留痕", async () => {
    const instanceId = await mkInstance(threeSteps())
    const patch = () =>
      app.inject({
        method: "PATCH",
        url: `/api/forms/${String(rFormId)}/records/${String(rRecordId)}`,
        headers: A(),
        payload: { expectedVersion: 1, values: { 品名: "改過的" } },
      })
    expect((await patch()).statusCode).toBe(409)

    const unlock = await app.inject({
      method: "POST",
      url: `/api/approvals/${String(instanceId)}/unlock`,
      headers: A(),
      payload: { comment: "簽核人已離職,先解鎖修正單據" },
    })
    expect(unlock.statusCode).toBe(200)
    expect((await patch()).statusCode).not.toBe(409)

    const logged = await pool.query(
      "SELECT comment FROM approval_step_log WHERE instance_id = $1 AND decision = 'unlock'",
      [instanceId],
    )
    expect(String(logged.rows[0]?.comment)).toContain("離職")
  })

  it("強制解鎖限管理員,且必須填理由", async () => {
    const instanceId = await mkInstance(threeSteps())
    const noReason = await app.inject({
      method: "POST",
      url: `/api/approvals/${String(instanceId)}/unlock`,
      headers: A(),
      payload: { comment: "" },
    })
    expect(noReason.statusCode).toBe(400)
  })
})
