import { Controller, Get, Inject, Post, UseGuards } from "@nestjs/common"
import { fromNodeHeaders } from "better-auth/node"
import type { FastifyRequest } from "fastify"
import { Req } from "@nestjs/common"
import type { createAuth } from "../auth/auth.js"
import { AUTH } from "../auth/auth.tokens.js"
import { IdentityService } from "../auth/identity.service.js"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { type AuthAuditRow, type DeviceSession, SecurityService } from "./security.service.js"

/* R1·A-1 M3|帳號安全 API。**恆為「只看自己的」** ——
   `authUserId` 由 `TenantContext.actorId` 反查,**不接受呼叫端指定**,
   否則就是一條看別人裝置清單的路徑。 */

@Controller("api/security")
@UseGuards(TenantGuard)
export class SecurityController {
  constructor(
    @Inject(SecurityService) private readonly security: SecurityService,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AUTH) private readonly auth: ReturnType<typeof createAuth>,
  ) {}

  @Get("sessions")
  async sessions(
    @Tenant() tenant: TenantContext,
    @Req() request: FastifyRequest,
  ): Promise<DeviceSession[]> {
    const authUserId = await this.identity.getAuthUserIdByActor(tenant.actorId)
    if (authUserId === null) return []
    return this.security.listSessions(authUserId, await this.currentToken(request))
  }

  @Post("sessions/revoke-others")
  async revokeOthers(
    @Tenant() tenant: TenantContext,
    @Req() request: FastifyRequest,
  ): Promise<{ sessions: number; apiKeys: number }> {
    const authUserId = await this.identity.getAuthUserIdByActor(tenant.actorId)
    if (authUserId === null) return { sessions: 0, apiKeys: 0 }
    const token = await this.currentToken(request)
    const result = await this.security.revokeOtherSessions(authUserId, token)
    await this.security.record({
      event: "session.revoke_others",
      authUserId,
      tenantId: tenant.tenantId,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      /* 只記數量,不記被撤的 token / 金鑰值(OWASP Logging 禁記清單) */
      detail: { sessions: result.sessions, apiKeys: result.apiKeys },
    })
    return result
  }

  @Get("audit")
  async audit(@Tenant() tenant: TenantContext): Promise<AuthAuditRow[]> {
    const authUserId = await this.identity.getAuthUserIdByActor(tenant.actorId)
    if (authUserId === null) return []
    return this.security.listAudit(authUserId)
  }

  /* dev 路徑沒有 session(刻意不觸 session,OQ-AUTH-7)→ null,
     此時「目前這台」無從標示,revoke 也就等同全撤。 */
  private async currentToken(request: FastifyRequest): Promise<string | null> {
    const session = await this.auth.api
      .getSession({ headers: fromNodeHeaders(request.headers) })
      .catch(() => null)
    return session?.session.token ?? null
  }
}
