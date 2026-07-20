import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common"
import type { RequestWithPermissions } from "./authz-http.js"
import { PermissionService } from "./permission.service.js"

/* P0-4a M5|租戶管理員守衛(權限管理後台專用)。掛 TenantGuard 之後。
   dev isSuperAdmin → 放行;prod → 需系統 admin 角色(deny 其他)。 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(PermissionService) private readonly permissions: PermissionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPermissions>()
    const tenant = request.tenantContext
    if (tenant === undefined) {
      throw new Error("AdminGuard requires tenant context; order it after TenantGuard")
    }
    if (tenant.isSuperAdmin === true) return true
    const effective = await this.permissions.resolveForActor(tenant.tenantId, tenant.actorId)
    if (!effective.isAdmin) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "requires tenant admin" })
    }
    return true
  }
}
