import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common"
import { fromNodeHeaders } from "better-auth/node"
import type { RequestWithTenant } from "../http/tenant-context.js"
import { AUTH } from "./auth.tokens.js"
import type { Auth } from "./auth.js"
import { IdentityService } from "./identity.service.js"
import { TenantContextMismatchError, isMutation, readOrgIntent } from "./org-intent.js"

/* client 送來的任何租戶提示一律剝除:租戶只出自伺服器驗證的 session(鐵則 3 / docs/21 §4)。 */
const CLIENT_TENANT_HEADERS = ["x-tenant-id", "x-dev-tenant", "x-dev-actor"] as const

/* F-2 M3|prod 租戶守衛:Better Auth session → activeOrg → 可信 tenantId + actorId → request.tenantContext。
   TenantContext 介面不變 → 下游 services(RecordService/DdlService/…)零改(OQ-AUTH-5)。 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>()

    for (const header of CLIENT_TENANT_HEADERS) {
      delete request.headers[header]
    }

    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    if (!session) {
      throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "no valid session" })
    }

    const orgId = session.session.activeOrganizationId
    if (typeof orgId !== "string" || orgId.length === 0) {
      throw new ForbiddenException({
        code: "NO_ACTIVE_ORG",
        message: "session has no active organization",
      })
    }

    /* 🔴 逐請求重驗成員資格 —— session 的 activeOrganizationId 是登入當下的快照,
       管理員移除他人不會使其失效(見 IdentityService.isOrgMember 註解)。
       不驗 = 移除成員形同 no-op。 */
    if (!(await this.identity.isOrgMember(session.user.id, orgId))) {
      throw new ForbiddenException({
        code: "NOT_ORG_MEMBER",
        message: "not a member of the active organization",
      })
    }

    /* 🔴 F-10|分頁級租戶。`activeOrganizationId` 是**整個瀏覽器共用**的,
       分頁 2 切公司會改到分頁 1 的租戶 → 分頁 1 的下一次寫入落到錯的公司。
       intent header 讓每個請求帶上「這個分頁以為自己在哪」;
       **語意與被剝除的 x-tenant-id 的差別見 org-intent.ts,改動前務必先讀。** */
    const intentOrgId = readOrgIntent(request.headers)
    let effectiveOrgId = orgId
    if (intentOrgId !== null && intentOrgId !== orgId) {
      /* 🔴 獨立查成員資格 —— 這一步是 intent 與授權結論的分界。拿掉它就是 BOLA。 */
      if (!(await this.identity.isOrgMember(session.user.id, intentOrgId))) {
        throw new ForbiddenException({
          code: "NOT_ORG_MEMBER",
          message: "not a member of the requested organization",
        })
      }
      /* 讀放行(回頭看舊分頁合理),寫擋下(讓人明確決定寫進哪一家)。
         **不寫回 session** —— 寫回等於把污染反向傳播到另一個分頁。 */
      if (isMutation(request.method)) throw new TenantContextMismatchError()
      effectiveOrgId = intentOrgId
    }

    const tenantId = await this.identity.getTenantIdByOrg(effectiveOrgId)
    if (tenantId === null) {
      throw new ForbiddenException({
        code: "TENANT_NOT_PROVISIONED",
        message: "active organization is not linked to a tenant",
      })
    }

    // 首次登入 JIT upsert(idempotent)→ actorId(= users.id;OQ-AUTH-4)
    const actorId = await this.identity.upsertUser({
      authUserId: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
    })

    request.tenantContext = { tenantId, actorId }
    return true
  }
}
