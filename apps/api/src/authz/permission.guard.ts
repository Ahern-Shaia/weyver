import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { type EffectivePermissions, adminPermissions } from "./authz-effective.js"
import { REQUIRED_FORM_ACTION, type RequestWithPermissions, SELF_SERVICE } from "./authz-http.js"
import { type FormAction, requiredActionForMethod } from "./authz-model.js"
import { PermissionService } from "./permission.service.js"

/* P0-4a M3|表單級授權守衛。掛在 TenantGuard 之後(需 request.tenantContext)。
   - 解析有效權限一次 → 掛 request.permissions(供 list 過濾 / 欄位級 M4 使用,等同 per-request 快取)。
   - 有 :formId 的路由:依所需級別(decorator 覆寫 or 方法推)驗該表存取,不足 → 403。
   - 無 :formId:read(list)放行(由 controller 依 permissions 過濾);write/manage(建表)需 admin。
   dev(isSuperAdmin)→ 全權;prod → 真實 role 解析(deny-by-default)。docs/modules/R1/authz.md §5.2。 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPermissions>()
    const tenant = request.tenantContext
    if (tenant === undefined) {
      throw new Error("PermissionGuard requires tenant context; order it after TenantGuard")
    }

    const effective: EffectivePermissions = tenant.isSuperAdmin
      ? adminPermissions()
      : await this.permissions.resolveForActor(tenant.tenantId, tenant.actorId)
    request.permissions = effective

    const required: FormAction =
      this.reflector.getAllAndOverride<FormAction | undefined>(REQUIRED_FORM_ACTION, [
        context.getHandler(),
        context.getClass(),
      ]) ?? requiredActionForMethod(request.method)

    const params = request.params as Record<string, string> | undefined
    const formIdRaw = params?.formId

    if (formIdRaw !== undefined) {
      const formId = Number(formIdRaw)
      if (!Number.isSafeInteger(formId) || !effective.hasAction(formId, required)) {
        throw new ForbiddenException({
          code: "FORBIDDEN",
          message: "insufficient permission for this form",
        })
      }
      return true
    }

    /* 自助端點:作用對象恆為操作者自己,不套下面那條「寫入需 admin」。
       刻意放在 formId 分支**之後** —— 萬一被誤標在有 formId 的路由上,
       表單權限仍然照驗,不會變成萬用旁路。見 authz-http.ts `SelfService`。 */
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(SELF_SERVICE, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    ) {
      return true
    }

    // 無 formId:讀(list)交給 controller 過濾;非讀(建表 create/design)需租戶管理權
    if (required !== "view" && !effective.isAdmin) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "requires admin to create or manage forms",
      })
    }
    return true
  }
}
