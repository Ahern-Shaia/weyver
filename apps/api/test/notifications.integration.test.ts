import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { roleMembers, roles, tenants, users } from "../src/db/schema.js"
import { LEVEL, NOTIFICATION_EVENTS } from "../src/notifications/notification-specs.js"
import type { NotificationRepository } from "../src/notifications/notification.repository.js"
import type { NotificationDispatcher } from "../src/notifications/notification-dispatcher.service.js"
import type { NotificationService } from "../src/notifications/notification.service.js"

/* H-1 M1|重點:簽核接通(本模組存在的理由)· 跨租戶隔離 · 風暴防護 · 標題不洩漏。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let notify: NotificationService
let repo: NotificationRepository
let dispatcher: NotificationDispatcher
let tenantA = 0
let tenantB = 0
let formId = 0
let recordId = 0
let approverRoleId = 0
let submitter = 0
let approver = 0
let bystander = 0
let tenantBUser = 0

const A = (): Record<string, string> => ({
  "x-dev-tenant": String(tenantA),
  "x-dev-actor": String(submitter),
})

async function inbox(actorId: number, tenantId = tenantA): Promise<string[]> {
  const rows = await pool.query<{ event: string }>(
    "SELECT event FROM notification WHERE tenant_id=$1 AND recipient_actor_id=$2 ORDER BY id",
    [tenantId, actorId],
  )
  return rows.rows.map((r) => r.event)
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  const uri = container.getConnectionUri()
  pool = new pg.Pool({ connectionString: uri, max: 5 })
  await runMigrations(pool)
  const db = createDrizzle(pool)

  const t = await db
    .insert(tenants)
    .values([{ name: "廠 A" }, { name: "廠 B" }])
    .returning()
  tenantA = t[0]?.id ?? 0
  tenantB = t[1]?.id ?? 0

  const u = await db
    .insert(users)
    .values([
      { authUserId: "sub", email: "sub@w.test", name: "林採購" },
      { authUserId: "app", email: "app@w.test", name: "王經理" },
      { authUserId: "by", email: "by@w.test", name: "路人" },
      { authUserId: "tb", email: "tb@w.test", name: "他廠" },
    ])
    .returning()
  submitter = u[0]?.id ?? 0
  approver = u[1]?.id ?? 0
  bystander = u[2]?.id ?? 0
  tenantBUser = u[3]?.id ?? 0

  const r = await db
    .insert(roles)
    .values([
      { tenantId: tenantA, key: "admin", name: "管理員" },
      { tenantId: tenantA, key: "mgr", name: "經理" },
      { tenantId: tenantB, key: "admin", name: "管理員" },
    ])
    .returning()
  const adminRole = r[0]?.id ?? 0
  approverRoleId = r[1]?.id ?? 0
  await db.insert(roleMembers).values([
    { tenantId: tenantA, roleId: adminRole, actorId: submitter },
    { tenantId: tenantA, roleId: approverRoleId, actorId: approver },
    { tenantId: tenantA, roleId: adminRole, actorId: bystander },
    { tenantId: tenantB, roleId: r[2]?.id ?? 0, actorId: tenantBUser },
  ])

  process.env.DATABASE_URL = uri
  process.env.APP_DATABASE_URL = uri
  const { AppModule } = await import("../src/app.module.js")
  const { configureApp } = await import("../src/app-setup.js")
  const { NotificationService: NS } = await import("../src/notifications/notification.service.js")
  const { NotificationRepository: NR } = await import(
    "../src/notifications/notification.repository.js"
  )
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await configureApp(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  notify = app.get(NS)
  repo = app.get(NR)
  const { NotificationDispatcher: ND } = await import(
    "../src/notifications/notification-dispatcher.service.js"
  )
  dispatcher = app.get(ND)

  const form = await app.inject({
    method: "POST",
    url: "/api/forms",
    headers: A(),
    payload: {
      name: "採購申請單",
      fields: [
        { name: "金額", type: "money", required: true },
        { name: "品名", type: "text" },
      ],
    },
  })
  formId = (form.json() as { id: number }).id
  const rec = await app.inject({
    method: "POST",
    url: `/api/forms/${formId}/records`,
    headers: A(),
    payload: { values: { 金額: "50000", 品名: "冷凍雞胸肉" } },
  })
  recordId = (rec.json() as { id: number }).id
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("H-1 簽核接通(本模組存在的理由)", () => {
  it("送簽 → 該關卡簽核者收到「待簽核」", async () => {
    const def = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/approvals/defs`,
      headers: A(),
      payload: {
        name: "採購簽核",
        active: true,
        steps: [{ stepNo: 1, approverRoleId }],
      },
    })
    expect(def.statusCode).toBe(201)

    const res = await app.inject({
      method: "POST",
      url: `/api/forms/${formId}/approvals/records/${recordId}/submit`,
      headers: A(),
    })
    expect(res.statusCode).toBe(200)
    expect(await inbox(approver)).toContain(NOTIFICATION_EVENTS.approvalPending)
  })

  it("**不通知觸發者自己** —— 送簽者不會收到自己送出的待簽通知", async () => {
    expect(await inbox(submitter)).not.toContain(NOTIFICATION_EVENTS.approvalPending)
  })

  it("**FMEA N2 跨租戶隔離**:B 租戶使用者收不到 A 的通知", async () => {
    expect(await inbox(tenantBUser, tenantB)).toHaveLength(0)
    expect(await inbox(tenantBUser, tenantA)).toHaveLength(0)
  })

  it("**FMEA N14 標題不含欄位值** —— 首欄是「金額」但標題不洩漏", async () => {
    const rows = await pool.query<{ title: string }>(
      "SELECT title FROM notification WHERE tenant_id=$1 AND recipient_actor_id=$2 LIMIT 1",
      [tenantA, approver],
    )
    const title = rows.rows[0]?.title ?? ""
    expect(title).toBe(`採購申請單 #${recordId}`)
    expect(title).not.toContain("50000")
    expect(title).not.toContain("冷凍雞胸肉")
  })
})

describe("H-1 訂閱層級與總開關", () => {
  it("預設層級「與我相關」→ 別人建的資料不通知路人", async () => {
    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.recordCreated,
      formId,
      recordId,
      actorId: submitter,
    })
    expect(await inbox(bystander)).not.toContain(NOTIFICATION_EVENTS.recordCreated)
  })

  it("層級調到「全部」→ 收得到", async () => {
    await repo.setPref({
      tenantId: tenantA,
      actorId: bystander,
      scope: "form",
      scopeId: formId,
      level: LEVEL.all,
      customEvents: null,
    })
    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.recordCreated,
      formId,
      recordId,
      actorId: submitter,
    })
    expect(await inbox(bystander)).toContain(NOTIFICATION_EVENTS.recordCreated)
  })

  it("總開關關閉 → 資料事件不送,**但簽核逾期仍送**(裁定 ④)", async () => {
    await repo.setSettings({ tenantId: tenantA, actorId: bystander, enabled: false, channels: null })
    const before = (await inbox(bystander)).length

    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.recordCreated,
      formId,
      recordId,
      actorId: submitter,
    })
    expect((await inbox(bystander)).length).toBe(before)

    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.approvalOverdue,
      formId,
      recordId,
      actorId: null,
      recipientActorIds: [bystander],
    })
    expect(await inbox(bystander)).toContain(NOTIFICATION_EVENTS.approvalOverdue)
  })
})

describe("H-1 通知與寄送分表 + 非關鍵路徑", () => {
  it("每則通知產生對應 delivery 列(pending)", async () => {
    const rows = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM notification_delivery d
       JOIN notification n ON n.id = d.notification_id
       WHERE n.tenant_id=$1 AND d.status='pending'`,
      [tenantA],
    )
    expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0)
  })

  it("**emit 失敗不拋出** —— 通知是非關鍵路徑,絕不讓簽核/存檔失敗", async () => {
    await expect(
      notify.emit({
        tenantId: tenantA,
        event: NOTIFICATION_EVENTS.recordCreated,
        formId: 99_999_999,
        recordId: null,
        actorId: null,
      }),
    ).resolves.toBe(0)
  })

  it("**無角色者仍收得到指名通知** —— 憑 owner / 租戶預設權限送簽者不該被靜默丟掉", async () => {
    const orphan = await pool.query<{ id: number }>(
      "INSERT INTO users (auth_user_id, email, name) VALUES ('orphan','orphan@w.test','無角色') RETURNING id",
    )
    const orphanId = orphan.rows[0]?.id ?? 0
    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.approvalApproved,
      formId,
      recordId,
      actorId: null,
      recipientActorIds: [orphanId],
    })
    expect(await inbox(orphanId)).toContain(NOTIFICATION_EVENTS.approvalApproved)
  })

  it("已停用使用者不收通知(FMEA N7)", async () => {
    await pool.query("UPDATE users SET deleted_at = now() WHERE id=$1", [bystander])
    await repo.setSettings({ tenantId: tenantA, actorId: bystander, enabled: true, channels: null })
    const before = (await inbox(bystander)).length
    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.recordCreated,
      formId,
      recordId,
      actorId: submitter,
    })
    expect((await inbox(bystander)).length).toBe(before)
    await pool.query("UPDATE users SET deleted_at = NULL WHERE id=$1", [bystander])
  })
})

describe("H-1 M3 Email 派工", () => {
  it("**SMTP 未設定 → skipped 而非 failed** —— 「還沒設定」不是「寄送失敗」", async () => {
    await pool.query("UPDATE notification_delivery SET next_attempt_at = now() WHERE channel='email'")
    await dispatcher.run()
    const rows = await pool.query<{ status: string; n: string }>(
      "SELECT status, count(*) AS n FROM notification_delivery WHERE channel='email' GROUP BY status",
    )
    const byStatus = Object.fromEntries(rows.rows.map((r) => [r.status, Number(r.n)]))
    expect(byStatus.failed ?? 0).toBe(0)
    expect((byStatus.skipped ?? 0) + (byStatus.pending ?? 0)).toBeGreaterThan(0)
  })

  it("**去抖動**:簽核類立即可送,一般資料異動排到視窗之後", async () => {
    await pool.query("DELETE FROM notification_delivery; DELETE FROM notification")
    /* 一般資料異動須層級到「全部」才會產生通知(預設「與我相關」不含旁人) */
    await repo.setPref({
      tenantId: tenantA,
      actorId: approver,
      scope: "form",
      scopeId: formId,
      level: LEVEL.all,
      customEvents: null,
    })
    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.approvalPending,
      formId,
      recordId,
      actorId: null,
      recipientActorIds: [approver],
    })
    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.recordUpdated,
      formId,
      recordId,
      actorId: null,
      recipientActorIds: [approver],
    })
    const rows = await pool.query<{ event: string; due: boolean }>(
      `SELECT n.event, (d.next_attempt_at <= now()) AS due
         FROM notification_delivery d JOIN notification n ON n.id=d.notification_id
        WHERE d.channel='email' ORDER BY n.id`,
    )
    const byEvent = Object.fromEntries(rows.rows.map((r) => [r.event, r.due]))
    expect(byEvent[NOTIFICATION_EVENTS.approvalPending]).toBe(true)
    expect(byEvent[NOTIFICATION_EVENTS.recordUpdated]).toBe(false)
  })

  it("**FMEA N15 抑制清單**:已抑制的位址不再寄送", async () => {
    const email = "app@w.test"
    await pool.query(
      "INSERT INTO email_suppression (email, reason) VALUES ($1,'hard_bounce') ON CONFLICT DO NOTHING",
      [email],
    )
    await pool.query("UPDATE notification_delivery SET next_attempt_at = now() WHERE channel='email'")
    await dispatcher.run()
    const rows = await pool.query<{ last_error: string | null }>(
      `SELECT d.last_error FROM notification_delivery d
         JOIN notification n ON n.id=d.notification_id
        WHERE d.channel='email' AND n.recipient_actor_id=$1 LIMIT 1`,
      [approver],
    )
    expect(rows.rows[0]?.last_error ?? "").toContain("已抑制")
    await pool.query("DELETE FROM email_suppression WHERE email=$1", [email])
  })

  it("通道偏好**逐人生效**:關掉 email 者只產生站內 delivery", async () => {
    await pool.query("DELETE FROM notification_delivery; DELETE FROM notification")
    await repo.setSettings({
      tenantId: tenantA,
      actorId: approver,
      enabled: true,
      channels: { "record.created": ["inapp"] },
    })
    await repo.setPref({
      tenantId: tenantA,
      actorId: approver,
      scope: "form",
      scopeId: formId,
      level: LEVEL.all,
      customEvents: null,
    })
    await notify.emitOrThrow({
      tenantId: tenantA,
      event: NOTIFICATION_EVENTS.recordCreated,
      formId,
      recordId,
      actorId: null,
      recipientActorIds: [approver],
    })
    const rows = await pool.query<{ channel: string }>(
      `SELECT d.channel FROM notification_delivery d JOIN notification n ON n.id=d.notification_id
        WHERE n.recipient_actor_id=$1`,
      [approver],
    )
    expect(rows.rows.map((r) => r.channel)).toEqual(["inapp"])
  })
})
