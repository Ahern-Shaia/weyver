import { createHash } from "node:crypto"
import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  UnprocessableEntityException,
} from "@nestjs/common"
import type { FastifyReply } from "fastify"
import type { Knex } from "knex"
import { Reflector } from "@nestjs/core"
import { type Observable, catchError, concatMap, from, of, switchMap, throwError } from "rxjs"
import { APP_KNEX } from "../db/db.module.js"
import type { RequestWithTenant } from "../http/tenant-context.js"

/* F-6 M1|冪等性(AGENTS ⚙️ [P0]:mutation 重試不重複建單)。

   **攔截器而非守衛**:需在 TenantGuard 之後取得 request.tenantContext(全域守衛早於
   controller 級守衛執行,故守衛拿不到租戶語境 —— 承 ApprovalLockInterceptor 之教訓)。

   語意(OQ-REL-1/5/6,對齊 Stripe):
   - `Idempotency-Key` 標頭**選填**;未帶 → 直接放行(既有呼叫端不受影響)
   - 首次 → 佔位列(in_flight)→ 成功後存回應 → 逾期前重放回同一結果(不重跑 handler)
   - 同 key 不同 body → 422(用戶端錯誤,絕不回放錯誤結果)
   - 同 key 併發中 → 409 請重試(不等待,FMEA L3 另有 expires_at 兜底)
   - handler 失敗 → 刪佔位列,使重試能真正重跑 */

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"])
/* Nest 之 @HttpCode metadata key。回應碼於序列化階段才寫入 reply,攔截器內取不到 →
   以與 Nest 相同的規則自行推算(宣告值優先,否則 POST=201 / 其餘=200),確保重放碼一致。 */
const HTTP_CODE_METADATA = "__httpCode__"
const TTL_HOURS = 24
const MAX_KEY_LENGTH = 255

interface StoredRow {
  readonly endpoint: string
  readonly request_hash: string
  readonly status: "in_flight" | "done"
  readonly response_code: number | null
  readonly response_body: unknown
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === undefined || value === "" ? undefined : value
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(APP_KNEX) private readonly knex: Knex,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle()
    const request = context.switchToHttp().getRequest<RequestWithTenant>()
    const tenant = request.tenantContext
    const key = headerValue(request.headers["idempotency-key"])
    if (tenant === undefined || key === undefined || !MUTATING.has(request.method)) {
      return next.handle()
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new UnprocessableEntityException({
        code: "IDEMPOTENCY_KEY_TOO_LONG",
        message: `Idempotency-Key 長度上限 ${MAX_KEY_LENGTH}`,
      })
    }

    const reply = context.switchToHttp().getResponse<FastifyReply>()
    const endpoint = `${request.method} ${request.routeOptions?.url ?? request.url}`
    // multipart 之 body 為串流不入 hash(檔案內容以 key 區辨即可);其餘一律納入
    const requestHash = createHash("sha256")
      .update(`${endpoint}\n${JSON.stringify(request.body ?? null)}`)
      .digest("hex")
    const tenantId = tenant.tenantId
    const successCode =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (request.method === "POST" ? 201 : 200)

    return from(this.claim(tenantId, key, endpoint, requestHash)).pipe(
      switchMap((existing) => {
        if (existing !== undefined) {
          if (existing.endpoint !== endpoint || existing.request_hash !== requestHash) {
            throw new UnprocessableEntityException({
              code: "IDEMPOTENCY_KEY_REUSED",
              message: "同一 Idempotency-Key 用於不同請求內容",
            })
          }
          if (existing.status === "in_flight") {
            throw new ConflictException({
              code: "IDEMPOTENT_REQUEST_IN_FLIGHT",
              message: "相同請求處理中,請稍後重試",
            })
          }
          reply.status(existing.response_code ?? 200)
          reply.header("idempotent-replay", "true")
          return of(existing.response_body)
        }
        return next.handle().pipe(
          // 先落盤再回應:否則緊接而來的重試會看到 in_flight 而拿 409(非預期的重放語意)
          concatMap(async (body: unknown) => {
            await this.complete(tenantId, key, successCode, body)
            return body
          }),
          // 失敗不留佔位列 → 重試可真正重跑(避免把一次性錯誤鎖成永久 409)
          catchError((error: unknown) =>
            from(this.release(tenantId, key)).pipe(concatMap(() => throwError(() => error))),
          ),
        )
      }),
    )
  }

  /* 佔位:成功插入 → undefined(可執行);衝突 → 回傳既有列(重放/拒絕判定)。
     逾期列視同不存在 → 覆寫為新的 in_flight。 */
  private async claim(
    tenantId: number,
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<StoredRow | undefined> {
    return this.inTenantTx(tenantId, async (trx) => {
      const inserted = await trx.raw<{ rows: unknown[] }>(
        `INSERT INTO idempotency_key
           (tenant_id, key, endpoint, request_hash, status, expires_at)
         VALUES (?, ?, ?, ?, 'in_flight', now() + interval '${TTL_HOURS} hours')
         ON CONFLICT (tenant_id, key) DO UPDATE
           SET endpoint = excluded.endpoint,
               request_hash = excluded.request_hash,
               status = 'in_flight',
               response_code = NULL,
               response_body = NULL,
               created_at = now(),
               expires_at = excluded.expires_at
           WHERE idempotency_key.expires_at < now()
         RETURNING key`,
        [tenantId, key, endpoint, requestHash],
      )
      if (inserted.rows.length > 0) return undefined
      const rows = await trx
        .table("idempotency_key")
        .where({ tenant_id: tenantId, key })
        .limit(1)
        .select<StoredRow[]>("endpoint", "request_hash", "status", "response_code", "response_body")
      return rows[0]
    })
  }

  private async complete(
    tenantId: number,
    key: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    await this.inTenantTx(tenantId, (trx) =>
      trx("idempotency_key")
        .where({ tenant_id: tenantId, key })
        .update({
          status: "done",
          response_code: statusCode,
          response_body: body === undefined ? null : JSON.stringify(body),
        }),
    )
  }

  private async release(tenantId: number, key: string): Promise<void> {
    await this.inTenantTx(tenantId, (trx) =>
      trx("idempotency_key").where({ tenant_id: tenantId, key, status: "in_flight" }).delete(),
    )
  }

  private async inTenantTx<T>(
    tenantId: number,
    fn: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.knex.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.tenant_id', ?, true)`, [String(tenantId)])
      return fn(trx)
    })
  }
}
