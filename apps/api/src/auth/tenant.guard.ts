import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { EntitlementService } from "../billing/entitlement.service.js"
import { isReadOnlyStatus, isWriteMethod } from "../billing/tenant-status.js"
import { DevTenantGuard } from "../http/dev-tenant.guard.js"
import type { RequestWithTenant } from "../http/tenant-context.js"
import { AuthGuard } from "./auth-guard.js"

/* 依環境分派租戶解析:認證強制(AuthGuard,真實 session)vs dev header(DevTenantGuard,x-dev-tenant)。
   強制條件 = production 一律,或 dev/test 設 ENFORCE_AUTH=1(測 auth-gate 用)。
   prod 路徑不觸 dev header,dev 路徑不觸 session —— 職責與攻擊面清楚隔離(OQ-AUTH-7)。

   F-8 M1|租戶解析成功後再做**生命週期檢查**(停權 → 唯讀)。放在這裡是因為
   本 guard 是每個請求解析租戶的**唯一入口** —— 日後在已上線系統的熱路徑補這一刀,
   成本遠高於現在(design doc §1.2 ②)。目前所有租戶皆 'active',**行為完全不變**。 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthGuard) private readonly authGuard: AuthGuard,
    @Inject(DevTenantGuard) private readonly devGuard: DevTenantGuard,
    @Inject(EntitlementService) private readonly entitlement: EntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enforce =
      this.config.get<string>("NODE_ENV") === "production" ||
      this.config.get<string>("ENFORCE_AUTH") === "1"
    const resolved = await (enforce
      ? this.authGuard.canActivate(context)
      : this.devGuard.canActivate(context))
    if (!resolved) return false

    const request = context.switchToHttp().getRequest<RequestWithTenant>()
    const tenantId = request.tenantContext?.tenantId
    if (tenantId === undefined) return true
    if (!isWriteMethod(request.method)) return true

    const plan = await this.entitlement.planFor(tenantId)
    if (isReadOnlyStatus(plan.status)) {
      throw new ForbiddenException({
        code: "TENANT_READ_ONLY",
        message: "帳戶目前為唯讀狀態,可檢視與匯出資料但無法變更。請聯繫服務窗口。",
      })
    }
    return true
  }
}
