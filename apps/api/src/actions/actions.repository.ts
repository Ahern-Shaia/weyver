import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import {
  actionAudits,
  approvalDefs,
  approvalInstances,
  approvalStepLogs,
  buttonDefs,
  roleMembers,
  roles,
} from "../db/schema.js"
import type { ApprovalStep, ButtonConfig } from "./action-specs.js"

/* R1·後續-1 按鈕/簽核資料存取(定義走 authz Tier-1 DRIZZLE 車道 + app tenant scope,OQ-AA-5;
   instance/log/audit 同車道以共用交易邊界)。 */

export interface ButtonRow {
  readonly id: number
  readonly formId: number
  readonly label: string
  readonly actionType: ButtonConfig["actionType"]
  readonly config: ButtonConfig
  readonly confirm: boolean
  readonly position: number
}

export interface ApprovalDefRow {
  readonly id: number
  readonly formId: number
  readonly name: string
  readonly steps: readonly ApprovalStep[]
  readonly onCompleteButtonId: number | null
  readonly active: boolean
}

export interface ApprovalInstanceRow {
  readonly id: number
  readonly defId: number
  readonly formId: number
  readonly recordId: number
  readonly currentStep: number
  readonly status: "pending" | "approved" | "rejected" | "withdrawn"
  readonly submittedBy: number
  readonly updatedAt: Date
}

/* 鏈斷點的三種原因,意義完全不同:
   preChain = 早於 hash chain 上線(0048 之前寫的),不是竄改
   tampered = 內容與自己的雜湊對不上 → 這一列被改過
   unlinked = 自己的雜湊沒問題,但接不上前一列 → 中間有列被刪掉或插入 */
export interface ApprovalChainBreak {
  readonly logId: number
  readonly instanceId: number
  readonly stepNo: number
  readonly createdAt: string
  readonly reason: "preChain" | "tampered" | "unlinked"
}

@Injectable()
export class ActionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // ---- buttons ----

  async listButtons(tenantId: number, formId: number): Promise<ButtonRow[]> {
    const rows = await this.db
      .select()
      .from(buttonDefs)
      .where(
        and(
          eq(buttonDefs.tenantId, tenantId),
          eq(buttonDefs.formId, formId),
          isNull(buttonDefs.deletedAt),
        ),
      )
      .orderBy(asc(buttonDefs.position), asc(buttonDefs.id))
    return rows.map(toButtonRow)
  }

  async getButton(tenantId: number, buttonId: number): Promise<ButtonRow | null> {
    const rows = await this.db
      .select()
      .from(buttonDefs)
      .where(
        and(
          eq(buttonDefs.tenantId, tenantId),
          eq(buttonDefs.id, buttonId),
          isNull(buttonDefs.deletedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row ? toButtonRow(row) : null
  }

  async createButton(input: {
    tenantId: number
    formId: number
    label: string
    config: ButtonConfig
    confirm: boolean
  }): Promise<ButtonRow> {
    const existing = await this.listButtons(input.tenantId, input.formId)
    const position = existing.reduce((m, b) => Math.max(m, b.position + 1), 0)
    const inserted = await this.db
      .insert(buttonDefs)
      .values({
        tenantId: input.tenantId,
        formId: input.formId,
        label: input.label,
        actionType: input.config.actionType,
        config: input.config,
        confirm: input.confirm,
        position,
      })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error("createButton: insert returned no row")
    return toButtonRow(row)
  }

  async updateButton(
    tenantId: number,
    buttonId: number,
    patch: {
      label?: string
      config?: ButtonConfig
      confirm?: boolean
      position?: number
    },
  ): Promise<void> {
    const set: Record<string, unknown> = {}
    if (patch.label !== undefined) set.label = patch.label
    if (patch.config !== undefined) {
      set.config = patch.config
      set.actionType = patch.config.actionType
    }
    if (patch.confirm !== undefined) set.confirm = patch.confirm
    if (patch.position !== undefined) set.position = patch.position
    if (Object.keys(set).length === 0) return
    await this.db
      .update(buttonDefs)
      .set(set)
      .where(and(eq(buttonDefs.tenantId, tenantId), eq(buttonDefs.id, buttonId)))
  }

  async softDeleteButton(tenantId: number, buttonId: number): Promise<void> {
    await this.db
      .update(buttonDefs)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(buttonDefs.tenantId, tenantId), eq(buttonDefs.id, buttonId)))
  }

  // ---- action audit(冪等)----

  /* 冪等 key 已存在 → 回既有稽核(呼叫端據此短路,不重複執行副作用,FMEA A2)。 */
  async findAuditByKey(
    tenantId: number,
    idempotencyKey: string,
  ): Promise<{ id: number; outcome: string; detail: unknown } | null> {
    const rows = await this.db
      .select({
        id: actionAudits.id,
        outcome: actionAudits.outcome,
        detail: actionAudits.detail,
      })
      .from(actionAudits)
      .where(
        and(eq(actionAudits.tenantId, tenantId), eq(actionAudits.idempotencyKey, idempotencyKey)),
      )
      .limit(1)
    return rows[0] ?? null
  }

  async writeAudit(input: {
    tenantId: number
    buttonId: number | null
    formId: number
    recordId: number
    actorId: number
    idempotencyKey: string
    outcome: string
    detail?: unknown
  }): Promise<void> {
    await this.db
      .insert(actionAudits)
      .values({
        tenantId: input.tenantId,
        buttonId: input.buttonId,
        formId: input.formId,
        recordId: input.recordId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        outcome: input.outcome,
        detail: input.detail ?? null,
      })
      .onConflictDoNothing({ target: [actionAudits.tenantId, actionAudits.idempotencyKey] })
  }

  // ---- approval defs ----

  async listApprovalDefs(tenantId: number, formId: number): Promise<ApprovalDefRow[]> {
    const rows = await this.db
      .select()
      .from(approvalDefs)
      .where(
        and(
          eq(approvalDefs.tenantId, tenantId),
          eq(approvalDefs.formId, formId),
          isNull(approvalDefs.deletedAt),
        ),
      )
      .orderBy(asc(approvalDefs.id))
    return rows.map(toApprovalDefRow)
  }

  async getApprovalDef(tenantId: number, defId: number): Promise<ApprovalDefRow | null> {
    const rows = await this.db
      .select()
      .from(approvalDefs)
      .where(
        and(
          eq(approvalDefs.tenantId, tenantId),
          eq(approvalDefs.id, defId),
          isNull(approvalDefs.deletedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row ? toApprovalDefRow(row) : null
  }

  async createApprovalDef(input: {
    tenantId: number
    formId: number
    name: string
    steps: readonly ApprovalStep[]
    onCompleteButtonId: number | null
    active: boolean
  }): Promise<ApprovalDefRow> {
    const inserted = await this.db
      .insert(approvalDefs)
      .values({
        tenantId: input.tenantId,
        formId: input.formId,
        name: input.name,
        steps: input.steps,
        onCompleteButtonId: input.onCompleteButtonId,
        active: input.active,
      })
      .returning()
    const row = inserted[0]
    if (!row) throw new Error("createApprovalDef: insert returned no row")
    return toApprovalDefRow(row)
  }

  async softDeleteApprovalDef(tenantId: number, defId: number): Promise<void> {
    await this.db
      .update(approvalDefs)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(approvalDefs.tenantId, tenantId), eq(approvalDefs.id, defId)))
  }

  // ---- approval instances ----

  async getActiveInstance(
    tenantId: number,
    formId: number,
    recordId: number,
  ): Promise<ApprovalInstanceRow | null> {
    const rows = await this.db
      .select()
      .from(approvalInstances)
      .where(
        and(
          eq(approvalInstances.tenantId, tenantId),
          eq(approvalInstances.formId, formId),
          eq(approvalInstances.recordId, recordId),
          eq(approvalInstances.status, "pending"),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row ? toInstanceRow(row) : null
  }

  async getLatestInstance(
    tenantId: number,
    formId: number,
    recordId: number,
  ): Promise<ApprovalInstanceRow | null> {
    const rows = await this.db
      .select()
      .from(approvalInstances)
      .where(
        and(
          eq(approvalInstances.tenantId, tenantId),
          eq(approvalInstances.formId, formId),
          eq(approvalInstances.recordId, recordId),
        ),
      )
      .orderBy(desc(approvalInstances.id))
      .limit(1)
    const row = rows[0]
    return row ? toInstanceRow(row) : null
  }

  async getInstance(tenantId: number, instanceId: number): Promise<ApprovalInstanceRow | null> {
    const rows = await this.db
      .select()
      .from(approvalInstances)
      .where(and(eq(approvalInstances.tenantId, tenantId), eq(approvalInstances.id, instanceId)))
      .limit(1)
    const row = rows[0]
    return row ? toInstanceRow(row) : null
  }

  /* 待簽清單:pending 實例(呼叫端依 actor 之角色閉包過濾當前步簽核者)。 */
  async listPendingInstances(tenantId: number): Promise<ApprovalInstanceRow[]> {
    const rows = await this.db
      .select()
      .from(approvalInstances)
      .where(and(eq(approvalInstances.tenantId, tenantId), eq(approvalInstances.status, "pending")))
      .orderBy(asc(approvalInstances.id))
    return rows.map(toInstanceRow)
  }

  async createInstance(input: {
    tenantId: number
    defId: number
    formId: number
    recordId: number
    currentStep: number
    submittedBy: number
  }): Promise<ApprovalInstanceRow> {
    const inserted = await this.db.insert(approvalInstances).values(input).returning()
    const row = inserted[0]
    if (!row) throw new Error("createInstance: insert returned no row")
    return toInstanceRow(row)
  }

  /* 🔴 條件式 UPDATE — 併發雙簽守衛(追溯稽核)。

     `decide()` 是「先讀 instance → 檢查 → 再寫」,兩人同時按核准會**雙雙通過檢查**
     然後各推進一關(或重複觸發完成副作用)。把「當時讀到的 status / currentStep」
     放進 WHERE,**由 DB 保證只有一個贏**;回傳受影響列數供呼叫端判定。

     回傳 false = 有人搶先改了狀態 → 呼叫端應回 409,而非靜默視為成功。 */
  async updateInstance(
    tenantId: number,
    instanceId: number,
    patch: { currentStep?: number; status?: string },
    expect?: { status?: string; currentStep?: number },
  ): Promise<boolean> {
    const set: Record<string, unknown> = { updatedAt: sql`now()` }
    if (patch.currentStep !== undefined) set.currentStep = patch.currentStep
    if (patch.status !== undefined) set.status = patch.status
    const guards = [
      eq(approvalInstances.tenantId, tenantId),
      eq(approvalInstances.id, instanceId),
      ...(expect?.status === undefined ? [] : [eq(approvalInstances.status, expect.status)]),
      ...(expect?.currentStep === undefined
        ? []
        : [eq(approvalInstances.currentStep, expect.currentStep)]),
    ]
    const rows = await this.db
      .update(approvalInstances)
      .set(set)
      .where(and(...guards))
      .returning({ id: approvalInstances.id })
    return rows.length > 0
  }

  /* 🔴 OQ-AP2-9|鏈完整性檢查。**只讀**,回傳斷點而不是布林 ——
     稽核者要的是「哪一筆、什麼時候、斷在哪」,一個「通過/不通過」答不了那個問題。
     算式在 DB 端(`approval_log_hash`),與 trigger 共用同一份;在這裡用 JS 重算一次
     就是兩份算式,而它們分岔的表現會是「稽核報告說鏈斷了」這種最難查的假警報。 */
  async chainBreaks(tenantId: number): Promise<ApprovalChainBreak[]> {
    const result = await this.db.execute<{
      log_id: string | number
      instance_id: string | number
      step_no: number
      created_at: Date | string
      reason: string
    }>(sql`SELECT * FROM public.approval_log_chain_breaks(${tenantId})`)
    return result.rows.map((r) => ({
      logId: Number(r.log_id),
      instanceId: Number(r.instance_id),
      stepNo: Number(r.step_no),
      createdAt: new Date(r.created_at).toISOString(),
      reason: r.reason as ApprovalChainBreak["reason"],
    }))
  }

  /* 🔴 OQ-AP2-1 = A|「直屬主管」由 **role tree 推導**,不引入第二份組織關係。

     定義:申請人**直接所屬角色**的父角色的成員(排除他自己)。
     `levels=2` 即再往上一層(直屬主管的主管)。

     為什麼不新增 `actors.manager_actor_id`(Salesforce / Ragic 的做法):
     role tree 已經是權限繼承的真實來源,再加一份組織關係就是兩份,
     而兩份組織結構必然分岔 —— 「權限樹改了、簽核流沒跟著改」是日常不是意外。
     誠實代價:這裡的「主管」是**一組人**不是一個人,故 N-of-M 是必需品而非選配。

     ⚠️ 與 `resolveActorRoleIds` 不同:那支是往上收集**所有**祖先(權限繼承要的),
     這裡要的是**恰好一層**的父角色 —— 收集全部祖先會讓「直屬主管」包含最高層,
     那不是直屬。 */
  async managersOf(tenantId: number, actorId: number, levels: 1 | 2): Promise<number[]> {
    const result = await this.db.execute<{ actor_id: string | number }>(sql`
      WITH RECURSIVE mine AS (
        SELECT r.id, r.parent_id, 0 AS lvl
          FROM ${roleMembers} rm
          JOIN ${roles} r ON r.id = rm.role_id
         WHERE rm.tenant_id = ${tenantId} AND rm.actor_id = ${actorId}
        UNION ALL
        SELECT p.id, p.parent_id, m.lvl + 1
          FROM ${roles} p
          JOIN mine m ON p.id = m.parent_id
         WHERE m.lvl < ${levels}
      )
      SELECT DISTINCT rm2.actor_id
        FROM mine
        JOIN ${roleMembers} rm2 ON rm2.role_id = mine.id
       WHERE mine.lvl = ${levels}
         AND rm2.tenant_id = ${tenantId}
         AND rm2.actor_id <> ${actorId}
    `)
    return result.rows.map((r) => Number(r.actor_id))
  }

  async actorsInRole(tenantId: number, roleId: number): Promise<number[]> {
    const rows = await this.db
      .select({ actorId: roleMembers.actorId })
      .from(roleMembers)
      .where(and(eq(roleMembers.tenantId, tenantId), eq(roleMembers.roleId, roleId)))
    return rows.map((r) => Number(r.actorId))
  }

  /* 這一關被臨時加簽進來的人。加簽是 append-only 的事實,存在 log 裡而不是另一張表 —— 
     「誰把誰拉進這一關」正是稽核要問的,不該放在可改的地方。 */
  async adhocApproversOf(tenantId: number, instanceId: number, stepNo: number): Promise<number[]> {
    const rows = await this.db
      .select({ actorId: approvalStepLogs.actorId })
      .from(approvalStepLogs)
      .where(
        and(
          eq(approvalStepLogs.tenantId, tenantId),
          eq(approvalStepLogs.instanceId, instanceId),
          eq(approvalStepLogs.stepNo, stepNo),
          eq(approvalStepLogs.decision, "addApprover"),
        ),
      )
    return rows.map((r) => Number(r.actorId))
  }

  /* 這一關已經核准過的人(去重)。**quorum 由 log 推導,不另存計數欄** ——
     計數欄與 log 是兩份真相,遲早分岔;而 log 本來就是 append-only 的那一份。 */
  async approversWhoApproved(
    tenantId: number,
    instanceId: number,
    stepNo: number,
  ): Promise<number[]> {
    const rows = await this.db
      .selectDistinct({ actorId: approvalStepLogs.actorId })
      .from(approvalStepLogs)
      .where(
        and(
          eq(approvalStepLogs.tenantId, tenantId),
          eq(approvalStepLogs.instanceId, instanceId),
          eq(approvalStepLogs.stepNo, stepNo),
          eq(approvalStepLogs.decision, "approve"),
        ),
      )
    return rows.map((r) => Number(r.actorId))
  }

  /* 前一位真的做出決定的人(submit / withdraw 不算)—— `managerOfPrevApprover` 用。 */
  async lastDecider(tenantId: number, instanceId: number): Promise<number | null> {
    const rows = await this.db
      .select({ actorId: approvalStepLogs.actorId })
      .from(approvalStepLogs)
      .where(
        and(
          eq(approvalStepLogs.tenantId, tenantId),
          eq(approvalStepLogs.instanceId, instanceId),
          inArray(approvalStepLogs.decision, ["approve", "reject"]),
        ),
      )
      .orderBy(desc(approvalStepLogs.id))
      .limit(1)
    return rows[0]?.actorId ?? null
  }

  async appendStepLog(input: {
    tenantId: number
    instanceId: number
    stepNo: number
    actorId: number
    decision: string
    /* 非 NULL = 這是代理行為;稽核要答得出「為什麼是他批的」 */
    onBehalfOfActorId?: number | null
    addedByActorId?: number | null
    comment?: string | undefined
  }): Promise<void> {
    await this.db.insert(approvalStepLogs).values({
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      stepNo: input.stepNo,
      actorId: input.actorId,
      decision: input.decision,
      onBehalfOfActorId: input.onBehalfOfActorId ?? null,
      addedByActorId: input.addedByActorId ?? null,
      comment: input.comment ?? null,
    })
  }

  async listStepLogs(
    tenantId: number,
    instanceId: number,
  ): Promise<
    {
      stepNo: number
      actorId: number
      decision: string
      onBehalfOfActorId: number | null
      comment: string | null
      at: string
    }[]
  > {
    const rows = await this.db
      .select()
      .from(approvalStepLogs)
      .where(
        and(eq(approvalStepLogs.tenantId, tenantId), eq(approvalStepLogs.instanceId, instanceId)),
      )
      .orderBy(asc(approvalStepLogs.id))
    return rows.map((r) => ({
      stepNo: r.stepNo,
      actorId: r.actorId,
      decision: r.decision,
      onBehalfOfActorId: r.onBehalfOfActorId,
      comment: r.comment,
      at: r.createdAt.toISOString(),
    }))
  }
}

function toButtonRow(row: typeof buttonDefs.$inferSelect): ButtonRow {
  return {
    id: row.id,
    formId: row.formId,
    label: row.label,
    actionType: row.actionType as ButtonConfig["actionType"],
    config: row.config as ButtonConfig,
    confirm: row.confirm,
    position: row.position,
  }
}

function toApprovalDefRow(row: typeof approvalDefs.$inferSelect): ApprovalDefRow {
  return {
    id: row.id,
    formId: row.formId,
    name: row.name,
    steps: row.steps as ApprovalStep[],
    onCompleteButtonId: row.onCompleteButtonId,
    active: row.active,
  }
}

function toInstanceRow(row: typeof approvalInstances.$inferSelect): ApprovalInstanceRow {
  return {
    id: row.id,
    defId: row.defId,
    formId: row.formId,
    recordId: row.recordId,
    currentStep: row.currentStep,
    status: row.status as ApprovalInstanceRow["status"],
    submittedBy: row.submittedBy,
    updatedAt: row.updatedAt,
  }
}
