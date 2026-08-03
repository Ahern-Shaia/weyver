import { Inject, Injectable } from "@nestjs/common"
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../db/db.module.js"
import { exportJobs } from "../db/schema.js"

/* R1·I-1|匯出工作的資料存取。**兩條車道刻意分開**:

   · 使用者面(建立 / 查自己的)走 **app 車道** —— RLS 執法,跨租戶讀不到是資料庫保證,
     不是靠服務層記得加 WHERE。migration 只授 SELECT/INSERT,連改自己那一列都不行。
   · worker 走 **特權車道** —— 它沒有租戶語境(要跨租戶找下一個 queued),
     且狀態推進 / 到期清理需要 UPDATE。 */

export interface ExportJobRow {
  readonly id: number
  readonly tenantId: number
  readonly requestedByActorId: number
  readonly status: string
  readonly formIds: number[] | null
  readonly includeAttachments: boolean
  readonly objectKey: string | null
  readonly sizeBytes: number | null
  readonly rowCount: number | null
  readonly downloadCount: number
  readonly error: string | null
  readonly createdAt: Date
  readonly readyAt: Date | null
  readonly expiresAt: Date | null
}

@Injectable()
export class ExportRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  /* 建立走 app 車道 —— RLS 的 WITH CHECK 保證寫進去的 tenant_id 只能是自己。 */
  async create(input: {
    tenantId: number
    actorId: number
    formIds: number[] | null
    includeAttachments: boolean
  }): Promise<ExportJobRow> {
    return this.tenantDb.withTenant(input.tenantId, async (tx) => {
      const rows = await tx
        .insert(exportJobs)
        .values({
          tenantId: input.tenantId,
          requestedByActorId: input.actorId,
          formIds: input.formIds,
          includeAttachments: input.includeAttachments,
        })
        .returning()
      const row = rows[0]
      if (row === undefined) throw new Error("insert export_job returned no row")
      return row as ExportJobRow
    })
  }

  async listForTenant(tenantId: number, limit = 20): Promise<ExportJobRow[]> {
    return this.tenantDb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.tenantId, tenantId))
        .orderBy(desc(exportJobs.createdAt))
        .limit(limit)
      return rows as ExportJobRow[]
    })
  }

  async getForTenant(tenantId: number, id: number): Promise<ExportJobRow | null> {
    return this.tenantDb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.tenantId, tenantId), eq(exportJobs.id, id)))
      return (rows[0] as ExportJobRow | undefined) ?? null
    })
  }

  /* 每日上限用。走 app 車道 → RLS 保證只數自己的。 */
  async countSince(tenantId: number, since: Date): Promise<number> {
    return this.tenantDb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ n: sql<string>`count(*)` })
        .from(exportJobs)
        .where(and(eq(exportJobs.tenantId, tenantId), gte(exportJobs.createdAt, since)))
      return Number(rows[0]?.n ?? 0)
    })
  }

  // ---- worker(特權車道)----

  /* 🔴 認領下一個工作。`FOR UPDATE SKIP LOCKED` 讓多個實例同時輪詢也不會搶到同一列 ——
     單實例時它是多餘的,但這正是「之後加了第二個實例才發現重複匯出」的那種缺陷,
     而那時的成本遠高於現在寫上這五個字。 */
  async claimNext(): Promise<ExportJobRow | null> {
    /* `execute` 的泛型要求 index signature;原生 pg 回來的本來就是任意鍵值物件,
       故先以 raw 形狀接,再由 `normalize()` 轉成有型別的列。 */
    const res = await this.db.execute<Record<string, unknown>>(sql`
      UPDATE export_job SET status = 'running', started_at = now()
       WHERE id = (
         SELECT id FROM export_job
          WHERE status = 'queued'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       RETURNING *
    `)
    const row = res.rows[0]
    return row === undefined ? null : normalize(row)
  }

  /* 🔴 認領一次下載。**條件式 UPDATE 一步完成「檢查 + 計數」** ——
     先查再寫的話,兩個分頁同時按下載就能各自看到「還剩 1 次」而雙雙通過。
     受影響列數為 0 即代表某個條件不成立,由呼叫端回查以給出精確原因。 */
  async claimDownload(
    tenantId: number,
    id: number,
    maxDownloads: number,
  ): Promise<{ objectKey: string; downloadCount: number } | null> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      UPDATE export_job
         SET download_count = download_count + 1
       WHERE id = ${id}
         AND tenant_id = ${tenantId}
         AND status = 'ready'
         AND object_key IS NOT NULL
         AND expires_at > now()
         AND download_count < ${maxDownloads}
      RETURNING object_key, download_count
    `)
    const row = res.rows[0]
    if (row === undefined) return null
    return {
      objectKey: String(row.object_key),
      downloadCount: Number(row.download_count),
    }
  }

  async markReady(
    id: number,
    input: { objectKey: string; sizeBytes: number; rowCount: number; expiresAt: Date },
  ): Promise<void> {
    await this.db
      .update(exportJobs)
      .set({
        status: "ready",
        objectKey: input.objectKey,
        sizeBytes: input.sizeBytes,
        rowCount: input.rowCount,
        readyAt: new Date(),
        expiresAt: input.expiresAt,
      })
      .where(eq(exportJobs.id, id))
  }

  /* 訊息會被使用者看到 → 呼叫端負責轉譯,這裡不做任何加工(加工會遮蔽真實原因)。 */
  async markFailed(id: number, message: string): Promise<void> {
    await this.db
      .update(exportJobs)
      .set({ status: "failed", error: message })
      .where(eq(exportJobs.id, id))
  }

  /* 到期:回傳要刪的 storage key,**列不刪**(誰帶走了整包資料是內控要問的)。 */
  async expireDue(now: Date): Promise<{ id: number; objectKey: string }[]> {
    const rows = await this.db
      .select({ id: exportJobs.id, objectKey: exportJobs.objectKey })
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.status, "ready"),
          isNotNull(exportJobs.expiresAt),
          lte(exportJobs.expiresAt, now),
        ),
      )
      .orderBy(asc(exportJobs.id))
    const due = rows.filter((r): r is { id: number; objectKey: string } => r.objectKey !== null)
    for (const row of due) {
      await this.db
        .update(exportJobs)
        .set({ status: "expired", objectKey: null })
        .where(eq(exportJobs.id, row.id))
    }
    return due
  }
}

/* 🔴 `db.execute` 走原生 pg:欄名是 **snake_case**、bigint 回**字串**。
   不逐欄轉的話 `job.tenantId` 會是 undefined 或 "1",而後續每一個比較都會安靜地錯
   —— 這正是本專案踩過的 knex bigint-as-string 同型問題。 */
function normalize(row: Record<string, unknown>): ExportJobRow {
  const ids = row.form_ids
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    requestedByActorId: Number(row.requested_by_actor_id),
    status: String(row.status),
    formIds: Array.isArray(ids) ? ids.map(Number) : null,
    includeAttachments: row.include_attachments === true,
    objectKey: (row.object_key as string | null) ?? null,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    rowCount: row.row_count === null ? null : Number(row.row_count),
    downloadCount: Number(row.download_count ?? 0),
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as Date,
    readyAt: (row.ready_at as Date | null) ?? null,
    expiresAt: (row.expires_at as Date | null) ?? null,
  }
}
