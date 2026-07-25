import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common"
import type { Observable } from "rxjs"
import type { RequestWithTenant } from "../http/tenant-context.js"
import { ActionsRepository } from "./actions.repository.js"

/* R1·後續-1 M2 記錄鎖(OQ-AA-6=A 整筆鎖;FMEA A4):簽核 pending 期間,該記錄之
   PATCH/DELETE 一律拒(防繞流程改單)。簽核流程自身副作用走 ButtonService(不經此路由)。

   為何是 interceptor 而非 guard:全域 guard 早於 controller 層 `TenantGuard` 執行,
   彼時 `request.tenantContext` 尚未解析;interceptor 在 guards 之後跑,可取得可信租戶。 */
@Injectable()
export class ApprovalLockInterceptor implements NestInterceptor {
  constructor(@Inject(ActionsRepository) private readonly repo: ActionsRepository) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>()
    const method = request.method
    if (method !== "PATCH" && method !== "DELETE") return next.handle()

    const tenant = request.tenantContext
    if (tenant === undefined) return next.handle()

    const params = request.params as Record<string, string> | undefined
    const formIdRaw = params?.formId
    const recordIdRaw = params?.recordId
    if (formIdRaw === undefined || recordIdRaw === undefined) return next.handle()
    if (!request.url.includes("/records/")) return next.handle()

    const formId = Number(formIdRaw)
    const recordId = Number(recordIdRaw)
    if (!Number.isSafeInteger(formId) || !Number.isSafeInteger(recordId)) return next.handle()

    const active = await this.repo.getActiveInstance(tenant.tenantId, formId, recordId)
    if (active !== null) {
      throw new ConflictException({
        code: "RECORD_LOCKED_BY_APPROVAL",
        message: "此記錄簽核中,不可修改(請先撤回或完成簽核)",
      })
    }
    return next.handle()
  }
}
