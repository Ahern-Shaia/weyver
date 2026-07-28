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

    const tenantId = await this.identity.getTenantIdByOrg(orgId)
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
