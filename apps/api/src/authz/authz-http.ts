import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common"
import type { RequestWithTenant } from "../http/tenant-context.js"
import type { EffectivePermissions } from "./authz-effective.js"
import type { FormAction } from "./authz-model.js"

/* PermissionGuard 解析後把有效權限掛在 request(對齊 TenantContext 掛 req 模式)。 */
export type RequestWithPermissions = RequestWithTenant & {
  permissions?: EffectivePermissions
}

/* 路由所需表單動作覆寫(缺省時 PermissionGuard 依 HTTP 方法推:GET=view / POST=create / PATCH=edit / DELETE=delete)。
   設計器路由標 'design';POST 但語意為讀(如 query 搜尋)標 'view';文件存檔標 'edit'。 */
export const REQUIRED_FORM_ACTION = "authz:requiredFormAction"
export const RequiresFormAction = (action: FormAction): MethodDecorator =>
  SetMetadata(REQUIRED_FORM_ACTION, action)

/* 🔴 本端點作用對象**恆為操作者自己**(個人設定、我的代理人…)。

   PermissionGuard 對「無 :formId 的非讀請求」預設要求 admin —— 那條規則是為了擋
   建表 / 改租戶設定,但它會連帶擋掉自助端點:一般員工連自己的語言時區都改不了。
   實測 `PATCH /api/settings/me` 對無角色使用者回 403,而測試與 dev 都看不到
   —— dev 一律 isSuperAdmin,整條分支從來沒有人走過。

   標了這個 decorator 的端點,授權由 controller/service 以 `tenant.actorId` 自行界定。 */
export const SELF_SERVICE = "authz:selfService"
export const SelfService = (): MethodDecorator => SetMetadata(SELF_SERVICE, true)

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
