import { Inject, Injectable } from "@nestjs/common"
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import { formDefs, users, viewDefs } from "../db/schema.js"
import { type ViewConfig, type ViewScope, viewConfigSchema } from "./view-specs.js"

/* R1·UP-2 view_def 資料存取(特權 DRIZZLE 車道,同 AuthzRepository;view_def 非 RLS,
   每查詢以 tenant_id 綁定 + app 層 scope,docs/modules/R1/views-list.md §7.3)。 */

export interface ViewRow {
  readonly id: number
  readonly tenantId: number
  readonly formId: number
  readonly name: string
  readonly scope: ViewScope
  readonly isDefault: boolean
  readonly locked: boolean
  readonly config: ViewConfig
  readonly position: number
  readonly createdBy: number | null
  readonly updatedAt: Date
}

export interface CreateViewInput {
  readonly tenantId: number
  readonly formId: number
  readonly actorId: number
  readonly name: string
  readonly scope: ViewScope
  readonly config: ViewConfig
  readonly isDefault: boolean
  readonly locked: boolean
}

export interface UpdateViewPatch {
  readonly name?: string
  readonly config?: ViewConfig
  readonly scope?: ViewScope
  readonly isDefault?: boolean
  readonly locked?: boolean
  readonly position?: number
}

type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0]

@Injectable()
export class ViewRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async formExists(tenantId: number, formId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: formDefs.id })
      .from(formDefs)
      .where(
        and(eq(formDefs.tenantId, tenantId), eq(formDefs.id, formId), isNull(formDefs.deletedAt)),
      )
      .limit(1)
    return rows.length > 0
  }

  /* 全部視圖(dev superadmin;prod 無 superadmin 概念,見 ViewService.list)。 */
  async listAll(tenantId: number, formId: number): Promise<ViewRow[]> {
    const rows = await this.db
      .select()
      .from(viewDefs)
      .where(
        and(
          eq(viewDefs.tenantId, tenantId),
          eq(viewDefs.formId, formId),
          isNull(viewDefs.deletedAt),
        ),
      )
      .orderBy(asc(viewDefs.position), asc(viewDefs.id))
    return rows.map(toViewRow)
  }

  /* actor 可見視圖:共通(全租戶)+ 自己的個人。 */
  async listForActor(tenantId: number, formId: number, actorId: number): Promise<ViewRow[]> {
    const rows = await this.db
      .select()
      .from(viewDefs)
      .where(
        and(
          eq(viewDefs.tenantId, tenantId),
          eq(viewDefs.formId, formId),
          isNull(viewDefs.deletedAt),
          or(eq(viewDefs.scope, "shared"), eq(viewDefs.createdBy, actorId)),
        ),
      )
      .orderBy(asc(viewDefs.position), asc(viewDefs.id))
    return rows.map(toViewRow)
  }

  async getById(tenantId: number, viewId: number): Promise<ViewRow | null> {
    const rows = await this.db
      .select()
      .from(viewDefs)
      .where(
        and(eq(viewDefs.tenantId, tenantId), eq(viewDefs.id, viewId), isNull(viewDefs.deletedAt)),
      )
      .limit(1)
    const row = rows[0]
    return row ? toViewRow(row) : null
  }

  async create(input: CreateViewInput): Promise<ViewRow> {
    return this.db.transaction(async (tx) => {
      if (input.isDefault) await clearDefaultTx(tx, input.tenantId, input.formId, null)
      const nextPos = await nextPositionTx(tx, input.tenantId, input.formId)
      // created_by FK → users:prod actorId 必為已 upsert 使用者;dev x-dev-actor 非真實 user → null
      const found = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.actorId))
        .limit(1)
      const createdBy = found[0]?.id ?? null
      const inserted = await tx
        .insert(viewDefs)
        .values({
          tenantId: input.tenantId,
          formId: input.formId,
          name: input.name,
          scope: input.scope,
          isDefault: input.isDefault,
          locked: input.locked,
          config: input.config,
          position: nextPos,
          createdBy,
        })
        .returning()
      const row = inserted[0]
      if (!row) throw new Error("createView: insert returned no row")
      return toViewRow(row)
    })
  }

  async update(tenantId: number, viewId: number, patch: UpdateViewPatch): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (patch.isDefault === true) {
        const target = await tx
          .select({ formId: viewDefs.formId })
          .from(viewDefs)
          .where(and(eq(viewDefs.tenantId, tenantId), eq(viewDefs.id, viewId)))
          .limit(1)
        const formId = target[0]?.formId
        if (formId !== undefined) await clearDefaultTx(tx, tenantId, formId, viewId)
      }
      const set: Record<string, unknown> = { updatedAt: sql`now()` }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.config !== undefined) set.config = patch.config
      if (patch.scope !== undefined) set.scope = patch.scope
      if (patch.isDefault !== undefined) set.isDefault = patch.isDefault
      if (patch.locked !== undefined) set.locked = patch.locked
      if (patch.position !== undefined) set.position = patch.position
      await tx
        .update(viewDefs)
        .set(set)
        .where(and(eq(viewDefs.tenantId, tenantId), eq(viewDefs.id, viewId)))
    })
  }

  async softDelete(tenantId: number, viewId: number): Promise<void> {
    await this.db
      .update(viewDefs)
      .set({ deletedAt: sql`now()`, isDefault: false })
      .where(and(eq(viewDefs.tenantId, tenantId), eq(viewDefs.id, viewId)))
  }
}

async function clearDefaultTx(
  tx: Tx,
  tenantId: number,
  formId: number,
  exceptViewId: number | null,
): Promise<void> {
  const where =
    exceptViewId === null
      ? and(
          eq(viewDefs.tenantId, tenantId),
          eq(viewDefs.formId, formId),
          eq(viewDefs.isDefault, true),
        )
      : and(
          eq(viewDefs.tenantId, tenantId),
          eq(viewDefs.formId, formId),
          eq(viewDefs.isDefault, true),
          ne(viewDefs.id, exceptViewId),
        )
  await tx.update(viewDefs).set({ isDefault: false }).where(where)
}

async function nextPositionTx(tx: Tx, tenantId: number, formId: number): Promise<number> {
  const rows = await tx
    .select({ position: viewDefs.position })
    .from(viewDefs)
    .where(
      and(eq(viewDefs.tenantId, tenantId), eq(viewDefs.formId, formId), isNull(viewDefs.deletedAt)),
    )
  return rows.reduce((max, r) => Math.max(max, r.position + 1), 0)
}

function toViewRow(row: typeof viewDefs.$inferSelect): ViewRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    formId: row.formId,
    name: row.name,
    scope: row.scope as ViewScope,
    isDefault: row.isDefault,
    locked: row.locked,
    // config 於寫入邊界經 viewConfigSchema 驗證;讀時再 parse 兜底 DB 竄改(fail-closed)
    config: viewConfigSchema.parse(row.config),
    position: row.position,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  }
}
