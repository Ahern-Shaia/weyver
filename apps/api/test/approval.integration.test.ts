import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { roles, tenants } from "../src/db/schema.js"

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
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
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
