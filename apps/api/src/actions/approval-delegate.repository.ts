import { Inject, Injectable } from "@nestjs/common"
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb } from "../db/db.module.js"
import { approvalDelegates } from "../db/schema.js"

/* #104 簽核代理人的資料存取。與 ActionsRepository 同車道(DRIZZLE + 每查詢綁 tenantId,
   OQ-AA-5)但獨立成檔 —— actions.repository.ts 已 466 行,再長下去沒人讀得完。 */

export interface DelegateRow {
  readonly id: number
  readonly principalActorId: number
  readonly delegateActorId: number
  readonly startsAt: Date
  readonly endsAt: Date | null
}

@Injectable()
export class ApprovalDelegateRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /* 🔴 時間窗**用 DB 的 now()** 而非應用層時間 —— 應用機器的時鐘漂移會讓
     「代理是否還有效」在不同節點得到不同答案,而這是授權判斷。 */
  async activeDelegatorsOf(tenantId: number, delegateActorId: number): Promise<number[]> {
    const rows = await this.db
      .select({ principal: approvalDelegates.principalActorId })
      .from(approvalDelegates)
      .where(
        and(
          eq(approvalDelegates.tenantId, tenantId),
          eq(approvalDelegates.delegateActorId, delegateActorId),
          lte(approvalDelegates.startsAt, sql`now()`),
          or(isNull(approvalDelegates.endsAt), gt(approvalDelegates.endsAt, sql`now()`)),
        ),
      )
    return rows.map((r) => r.principal)
  }

  /* 反向:這些人目前有效的代理人有誰(通知用)。
     一次查完而非每人一查 —— 簽核關卡的角色成員可能有數十人,逐一查是 N+1。 */
  async activeDelegatesFor(
    tenantId: number,
    principalActorIds: readonly number[],
  ): Promise<number[]> {
    if (principalActorIds.length === 0) return []
    const rows = await this.db
      .select({ delegate: approvalDelegates.delegateActorId })
      .from(approvalDelegates)
      .where(
        and(
          eq(approvalDelegates.tenantId, tenantId),
          inArray(approvalDelegates.principalActorId, [...principalActorIds]),
          lte(approvalDelegates.startsAt, sql`now()`),
          or(isNull(approvalDelegates.endsAt), gt(approvalDelegates.endsAt, sql`now()`)),
        ),
      )
    return rows.map((r) => r.delegate)
  }

  /* 「我把簽核權交給了誰」。含已過期的 —— 使用者要看得到歷史才知道自己設過什麼。 */
  async listByPrincipal(tenantId: number, principalActorId: number): Promise<DelegateRow[]> {
    return this.db
      .select({
        id: approvalDelegates.id,
        principalActorId: approvalDelegates.principalActorId,
        delegateActorId: approvalDelegates.delegateActorId,
        startsAt: approvalDelegates.startsAt,
        endsAt: approvalDelegates.endsAt,
      })
      .from(approvalDelegates)
      .where(
        and(
          eq(approvalDelegates.tenantId, tenantId),
          eq(approvalDelegates.principalActorId, principalActorId),
        ),
      )
      .orderBy(asc(approvalDelegates.startsAt))
  }

  /* 「誰把簽核權交給了我」—— 代理人得知道自己身上背著什麼責任,
     否則簽核匣裡多出來的單據會像是系統出錯。 */
  async listByDelegate(tenantId: number, delegateActorId: number): Promise<DelegateRow[]> {
    return this.db
      .select({
        id: approvalDelegates.id,
        principalActorId: approvalDelegates.principalActorId,
        delegateActorId: approvalDelegates.delegateActorId,
        startsAt: approvalDelegates.startsAt,
        endsAt: approvalDelegates.endsAt,
      })
      .from(approvalDelegates)
      .where(
        and(
          eq(approvalDelegates.tenantId, tenantId),
          eq(approvalDelegates.delegateActorId, delegateActorId),
          lte(approvalDelegates.startsAt, sql`now()`),
          or(isNull(approvalDelegates.endsAt), gt(approvalDelegates.endsAt, sql`now()`)),
        ),
      )
      .orderBy(asc(approvalDelegates.startsAt))
  }

  async create(input: {
    tenantId: number
    principalActorId: number
    delegateActorId: number
    startsAt: Date | null
    endsAt: Date | null
    createdByActorId: number
  }): Promise<DelegateRow> {
    const rows = await this.db
      .insert(approvalDelegates)
      .values({
        tenantId: input.tenantId,
        principalActorId: input.principalActorId,
        delegateActorId: input.delegateActorId,
        /* 省略即用 DB 預設 now() —— 同上,時間基準只有一個 */
        ...(input.startsAt === null ? {} : { startsAt: input.startsAt }),
        endsAt: input.endsAt,
        createdByActorId: input.createdByActorId,
      })
      .returning({
        id: approvalDelegates.id,
        principalActorId: approvalDelegates.principalActorId,
        delegateActorId: approvalDelegates.delegateActorId,
        startsAt: approvalDelegates.startsAt,
        endsAt: approvalDelegates.endsAt,
      })
    const row = rows[0]
    if (row === undefined) throw new Error("insert approval_delegate returned no row")
    return row
  }

  async getById(tenantId: number, id: number): Promise<DelegateRow | null> {
    const rows = await this.db
      .select({
        id: approvalDelegates.id,
        principalActorId: approvalDelegates.principalActorId,
        delegateActorId: approvalDelegates.delegateActorId,
        startsAt: approvalDelegates.startsAt,
        endsAt: approvalDelegates.endsAt,
      })
      .from(approvalDelegates)
      .where(and(eq(approvalDelegates.tenantId, tenantId), eq(approvalDelegates.id, id)))
    return rows[0] ?? null
  }

  async delete(tenantId: number, id: number): Promise<void> {
    await this.db
      .delete(approvalDelegates)
      .where(and(eq(approvalDelegates.tenantId, tenantId), eq(approvalDelegates.id, id)))
  }
}
