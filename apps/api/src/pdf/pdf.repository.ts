import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, sql } from "drizzle-orm"
import { DRIZZLE, type DrizzleDb, TenantDb } from "../db/db.module.js"
import { pdfJobs } from "../db/schema.js"

export interface PdfJobRow {
  readonly id: number
  readonly tenantId: number
  readonly requestedByActorId: number
  readonly formId: number
  readonly recordIds: number[]
  readonly status: string
  readonly objectKey: string | null
  readonly sizeBytes: number | null
  readonly ticketUsedAt: Date | null
  readonly downloadCount: number
  readonly error: string | null
  readonly createdAt: Date
  readonly readyAt: Date | null
  readonly expiresAt: Date | null
}

/* R1·後續-2b|PDF 工作的資料存取。**兩條車道刻意分開**,與 `export_job` 同一個切法:

   · 使用者面(建立 / 查自己的)走 **app 車道** —— RLS 執法,跨租戶讀不到是資料庫保證。
     migration 只授 SELECT/INSERT,使用者連把自己的工作改成 `ready` 都不行。
   · worker 與**票的核銷**走 **特權車道** —— worker 沒有租戶語境(要跨租戶找下一件),
     而核銷票的請求來自渲染器,它同樣沒有身分。 */
@Injectable()
export class PdfRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  async create(input: {
    tenantId: number
    actorId: number
    formId: number
    recordIds: readonly number[]
  }): Promise<PdfJobRow> {
    return this.tenantDb.withTenant(input.tenantId, async (tx) => {
      const rows = await tx
        .insert(pdfJobs)
        .values({
          tenantId: input.tenantId,
          requestedByActorId: input.actorId,
          formId: input.formId,
          recordIds: [...input.recordIds],
        })
        .returning()
      const row = rows[0]
      if (row === undefined) throw new Error("insert pdf_job returned no row")
      return row as PdfJobRow
    })
  }

  /* 🔴 同時綁 tenant 與 actor。只綁 tenant 是這個 repo 已經踩過的形狀:
     `pitfall-tenant-scoped-is-not-authorized` —— BOLA 的典型形態在租戶**之內**。 */
  async findOwn(tenantId: number, actorId: number, id: number): Promise<PdfJobRow | null> {
    return this.tenantDb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(pdfJobs)
        .where(
          and(
            eq(pdfJobs.tenantId, tenantId),
            eq(pdfJobs.requestedByActorId, actorId),
            eq(pdfJobs.id, id),
          ),
        )
        .limit(1)
      return (rows[0] as PdfJobRow | undefined) ?? null
    })
  }

  async listOwn(tenantId: number, actorId: number, limit = 20): Promise<PdfJobRow[]> {
    return this.tenantDb.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(pdfJobs)
        .where(and(eq(pdfJobs.tenantId, tenantId), eq(pdfJobs.requestedByActorId, actorId)))
        .orderBy(desc(pdfJobs.id))
        .limit(limit)
      return rows as PdfJobRow[]
    })
  }

  /* worker 取件:跨租戶,原子取得。`SKIP LOCKED` 讓多實例部署不會撿到同一件。

     🔴 **票在這一刻才發**。撿件與發票是同一個 UPDATE,所以:
     · 票只在工作真的要跑的那幾秒內存在
     · 明文永遠只在撿到它的那個 worker 行程裡 —— 不經 API 回應、不經使用者、
       多實例部署也不會發生「A 發票 B 渲染」
     · `redeemTicket` 要求 `status = 'running'`,於是還沒開始跑的工作票一律無效 */
  async claimNext(ticketHash: string): Promise<PdfJobRow | null> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      UPDATE pdf_job SET status = 'running', started_at = now(), ticket_hash = ${ticketHash}
      WHERE id = (
        SELECT id FROM pdf_job WHERE status = 'queued'
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING *
    `)
    const row = res.rows[0]
    return row === undefined ? null : normalize(row)
  }

  /* 🔴 核銷票:**條件更新即認證**。`ticket_used_at IS NULL` 放在 WHERE 裡,
     兩個並發請求只有一個會影響到列 —— 先讀後寫檢查會有競態窗。 */
  async redeemTicket(ticketHash: string, maxAgeSeconds: number): Promise<PdfJobRow | null> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      UPDATE pdf_job SET ticket_used_at = now()
      WHERE ticket_hash = ${ticketHash}
        AND ticket_used_at IS NULL
        AND status = 'running'
        AND created_at > now() - make_interval(secs => ${maxAgeSeconds})
      RETURNING *
    `)
    const row = res.rows[0]
    return row === undefined ? null : normalize(row)
  }

  async markReady(
    id: number,
    objectKey: string,
    sizeBytes: number,
    ttlDays: number,
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE pdf_job
      SET status = 'ready', object_key = ${objectKey}, size_bytes = ${sizeBytes},
          ready_at = now(), expires_at = now() + make_interval(days => ${ttlDays}), error = NULL
      WHERE id = ${id}
    `)
  }

  async markFailed(id: number, message: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE pdf_job SET status = 'failed', error = ${message}, ready_at = now() WHERE id = ${id}
    `)
  }

  async countDownload(id: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE pdf_job SET download_count = download_count + 1 WHERE id = ${id}
    `)
  }
}

/* 原生 pg 回來的是任意鍵值物件(且 bigint 是字串)—— 在這裡一次轉成有型別的列,
   不讓 snake_case 與字串數字漏進服務層。與 `export.repository` 同一個處置。 */
function normalize(row: Record<string, unknown>): PdfJobRow {
  const ids = row.record_ids
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    requestedByActorId: Number(row.requested_by_actor_id),
    formId: Number(row.form_id),
    recordIds: Array.isArray(ids) ? ids.map(Number) : [],
    status: String(row.status),
    objectKey: (row.object_key as string | null) ?? null,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    ticketUsedAt: (row.ticket_used_at as Date | null) ?? null,
    downloadCount: Number(row.download_count ?? 0),
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as Date,
    readyAt: (row.ready_at as Date | null) ?? null,
    expiresAt: (row.expires_at as Date | null) ?? null,
  }
}
