import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common"
import { Inject } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type { RequestWithTenant } from "./tenant-context.js"

/* 🔴 F-10 說明|**dev 車道對跨分頁租戶污染結構上免疫**,因此本檔不需改。

   prod 的問題是租戶來自**整個瀏覽器共用**的 session 列(`activeOrganizationId`),
   分頁 2 切公司會改到分頁 1 的租戶。而 dev 的租戶本來就由 `x-dev-tenant`
   **每個請求各自帶**,天然是分頁級的 —— 沒有共用狀態可被污染。

   **不要為了「dev/prod 一致」在這裡加 intent header 機制** —— 那會是一個
   永遠不會觸發的分支,反而讓人以為 dev 有測到 mismatch 流程。
   mismatch 對話框請以前端測試與 prod e2e 覆蓋。

   ⚠️ 開發 / 測試期 stub(prod 由 AuthGuard 接管,見 tenant.guard.ts 分派):
   - 租戶識別暫取 x-dev-tenant header(F-2 後改為驗證過的 JWT tenant_id,剝除 client header — 鐵則 3)
   - production 一律拒絕(fail-closed):auth 未接不得對外服務 */
@Injectable()
export class DevTenantGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>("NODE_ENV") === "production") {
      throw new ForbiddenException({
        code: "AUTH_NOT_CONFIGURED",
        message: "dev tenant guard is disabled in production; wire real auth (F-2)",
      })
    }
    const request = context.switchToHttp().getRequest<RequestWithTenant>()
    const rawTenant = request.headers["x-dev-tenant"]
    const tenantId = Number(Array.isArray(rawTenant) ? rawTenant[0] : rawTenant)
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
      throw new UnauthorizedException({
        code: "TENANT_REQUIRED",
        message: "missing or invalid x-dev-tenant header",
      })
    }
    const rawActor = request.headers["x-dev-actor"]
    const actorId = Number(Array.isArray(rawActor) ? rawActor[0] : (rawActor ?? "1"))
    /* 🔴 x-dev-real-authz: 1 → 這個請求改走真實角色解析(#96 實走時發現)。
       dev 一律 super admin 的話,「只看自己的」這類範圍限制在瀏覽器裡永遠看不到效果 ——
       而權限功能的預設失效模式正是「設了以為對了」,不能只靠整合測。 */
    const rawReal = request.headers["x-dev-real-authz"]
    const realAuthz = (Array.isArray(rawReal) ? rawReal[0] : rawReal) === "1"
    request.tenantContext = {
      tenantId,
      actorId: Number.isSafeInteger(actorId) && actorId > 0 ? actorId : 1,
      // dev 預設略過三層權限(建表/填單體驗);真正 authz 執法由 Testcontainers 整合測驗證
      isSuperAdmin: !realAuthz,
    }
    return true
  }
}
