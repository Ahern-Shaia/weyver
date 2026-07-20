import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common"
import type { RequestWithTenant } from "../http/tenant-context.js"
import type { EffectivePermissions } from "./authz-effective.js"
import type { FormLevel } from "./authz-model.js"

/* PermissionGuard 解析後把有效權限掛在 request(對齊 TenantContext 掛 req 模式)。 */
export type RequestWithPermissions = RequestWithTenant & {
  permissions?: EffectivePermissions
}

/* 路由所需表單級別覆寫(缺省時 PermissionGuard 依 HTTP 方法推:GET=read 其餘=write)。
   設計器/破壞性操作標 'manage';POST 但語意為讀(如 query 搜尋)標 'read'。 */
export const REQUIRED_FORM_LEVEL = "authz:requiredFormLevel"
export const RequiresFormLevel = (level: FormLevel): MethodDecorator =>
  SetMetadata(REQUIRED_FORM_LEVEL, level)

/* 取 PermissionGuard 掛上的有效權限(list 端點過濾用)。 */
export const Permissions = createParamDecorator(
  (_data: unknown, context: ExecutionContext): EffectivePermissions => {
    const request = context.switchToHttp().getRequest<RequestWithPermissions>()
    const permissions = request.permissions
    if (permissions === undefined) {
      throw new Error("permissions missing; PermissionGuard not applied")
    }
    return permissions
  },
)
