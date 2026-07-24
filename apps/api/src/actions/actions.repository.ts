import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import {
  actionAudits,
  approvalDefs,
  approvalInstances,
  approvalStepLogs,
  buttonDefs,
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

  async updateInstance(
    tenantId: number,
    instanceId: number,
    patch: { currentStep?: number; status?: string },
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: sql`now()` }
    if (patch.currentStep !== undefined) set.currentStep = patch.currentStep
    if (patch.status !== undefined) set.status = patch.status
    await this.db
      .update(approvalInstances)
      .set(set)
      .where(and(eq(approvalInstances.tenantId, tenantId), eq(approvalInstances.id, instanceId)))
  }

  async appendStepLog(input: {
    tenantId: number
    instanceId: number
    stepNo: number
    actorId: number
    decision: string
    comment?: string | undefined
  }): Promise<void> {
    await this.db.insert(approvalStepLogs).values({
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      stepNo: input.stepNo,
      actorId: input.actorId,
      decision: input.decision,
      comment: input.comment ?? null,
    })
  }

  async listStepLogs(
    tenantId: number,
    instanceId: number,
  ): Promise<
    { stepNo: number; actorId: number; decision: string; comment: string | null; at: string }[]
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
