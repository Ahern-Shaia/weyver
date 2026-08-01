import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { fromNodeHeaders } from "better-auth/node"
import type pg from "pg"
import { EntitlementService } from "../billing/entitlement.service.js"
import { isReadOnlyStatus, isWriteMethod } from "../billing/tenant-status.js"
import { DevTenantGuard } from "../http/dev-tenant.guard.js"
import type { RequestWithTenant } from "../http/tenant-context.js"
import { PG_POOL } from "../db/db.module.js"
import { AuthGuard } from "./auth-guard.js"
import { AUTH } from "./auth.tokens.js"
import type { Auth } from "./auth.js"
import { mustChangePassword } from "./initial-credential.js"

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
    @Inject(AUTH) private readonly auth: Auth,
    /* `initial_credential` 刻意無 RLS(判斷發生在租戶語境之前)→ 走特權車道 */
    @Inject(PG_POOL) private readonly pool: pg.Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    /* 三個來源取「或」—— 只能加嚴不能放寬。
       `WEYVER_ENFORCE_PROD_SECURITY` 為無預設之顯式旗標:NODE_ENV 有 `.default("development")`,
       prod 漏設時會靜默降級為 dev 旁路(任何人送 x-dev-tenant 即得 isSuperAdmin)。 */
    const enforce =
      this.config.get<string>("NODE_ENV") === "production" ||
      this.config.get<string>("WEYVER_ENFORCE_PROD_SECURITY") === "1" ||
      this.config.get<string>("ENFORCE_AUTH") === "1"
    const resolved = await (enforce
      ? this.authGuard.canActivate(context)
      : this.devGuard.canActivate(context))
    if (!resolved) return false

    const request = context.switchToHttp().getRequest<RequestWithTenant>()

    /* 🔴 「還在用管理員給的初始密碼」的閘門要**兩條路都攔**(ASVS §V6.4.1)。

       它問的是「拿著這個 session 的人」,與租戶怎麼解析無關,所以放在分派**之後**、
       兩條路的共同出口。原本只寫在 AuthGuard 裡 —— 而 dev 走 DevTenantGuard,
       閘門整個不執行:e2e 實測新同事用初始密碼直接進到工作區。
       只在 prod 生效的安全機制,等同於**從來沒有人驗證過**。

       prod 路徑的身分由 AuthGuard 帶上(`request.authUserId`),不重複查 session;
       dev 路徑沒有那一步,但**登入流程是真的**、cookie 也在 → 回頭查一次。
       兩邊都沒有身分時就沒有「這個人」可問,略過。 */
    const authUserId =
      request.authUserId ??
      (
        await this.auth.api
          .getSession({ headers: fromNodeHeaders(request.headers) })
          .catch(() => null)
      )?.user.id
    if (authUserId !== undefined && (await mustChangePassword(this.pool, authUserId))) {
      throw new ForbiddenException({
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "請先設定你自己的密碼",
      })
    }

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
