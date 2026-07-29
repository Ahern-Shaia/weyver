import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import type { Observable } from "rxjs"
import type { RequestWithTenant } from "../http/tenant-context.js"
import { ActionsRepository } from "./actions.repository.js"

/* 顯式豁免。**用標記而非 URL 字串比對** —— 靠字串正是原本的破口:
   漏比對到就等於漏保護。標記的失敗方向相反:忘了標就是「照擋」,fail-closed。
   目前唯一的豁免是送簽本身 —— 它不是改資料,而且該路徑的專屬錯誤
   (APPROVAL_IN_PROGRESS)比通用的「記錄已鎖」更能說明狀況。 */
export const SKIP_APPROVAL_LOCK = "approval:skipLock"
export const SkipApprovalLock = (): MethodDecorator => SetMetadata(SKIP_APPROVAL_LOCK, true)

/* R1·後續-1 M2 記錄鎖(OQ-AA-6=A 整筆鎖;FMEA A4):簽核 pending 期間,該記錄之
   PATCH/DELETE 一律拒(防繞流程改單)。簽核流程自身副作用走 ButtonService(不經此路由)。

   為何是 interceptor 而非 guard:全域 guard 早於 controller 層 `TenantGuard` 執行,
   彼時 `request.tenantContext` 尚未解析;interceptor 在 guards 之後跑,可取得可信租戶。 */
@Injectable()
export class ApprovalLockInterceptor implements NestInterceptor {
  constructor(
    @Inject(ActionsRepository) private readonly repo: ActionsRepository,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (this.reflector.get<boolean>(SKIP_APPROVAL_LOCK, context.getHandler()) === true) {
      return next.handle()
    }
    const request = context.switchToHttp().getRequest<RequestWithTenant>()
    const method = request.method
    if (method !== "PATCH" && method !== "DELETE" && method !== "POST") return next.handle()

    const tenant = request.tenantContext
    if (tenant === undefined) return next.handle()

    const params = request.params as Record<string, string> | undefined
    const formIdRaw = params?.formId
    const recordIdRaw = params?.recordId
    if (formIdRaw === undefined || recordIdRaw === undefined) return next.handle()

    /* 🔴 判定改以「路由帶 recordId」為準,不再要求 url 含 `/records/`(橫切 sweep)。
       原本的字串比對讓 `POST /forms/:id/buttons/:id/run/:recordId` 完全不受保護 ——
       而按鈕本來就是設計來改記錄的,是繞過鎖最順手的路。
       **送簽自己不受影響**:`POST .../approvals/records/:recordId/submit` 執行當下
       尚無進行中的簽核,查不到 active instance 即放行。
       簽核流程自身的副作用走 ButtonService(不經 HTTP 路由),故不受此限。 */

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
