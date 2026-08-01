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
    const me = await this.whoami(tenant, request)
    if (me.authUserId === null) return []
    return this.security.listSessions(me.authUserId, me.token)
  }

  @Post("sessions/revoke-others")
  async revokeOthers(
    @Tenant() tenant: TenantContext,
    @Req() request: FastifyRequest,
  ): Promise<{ sessions: number; apiKeys: number; trustedDevices: number }> {
    const me = await this.whoami(tenant, request)
    const authUserId = me.authUserId
    if (authUserId === null) return { sessions: 0, apiKeys: 0, trustedDevices: 0 }
    const result = await this.security.revokeOtherSessions(authUserId, me.token)
    await this.security.record({
      event: "session.revoke_others",
      authUserId,
      tenantId: tenant.tenantId,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      /* 只記數量,不記被撤的 token / 金鑰值(OWASP Logging 禁記清單) */
      detail: {
        sessions: result.sessions,
        apiKeys: result.apiKeys,
        trustedDevices: result.trustedDevices,
      },
    })
    return result
  }

  @Get("audit")
  async audit(
    @Tenant() tenant: TenantContext,
    @Req() request: FastifyRequest,
  ): Promise<AuthAuditRow[]> {
    const me = await this.whoami(tenant, request)
    if (me.authUserId === null) return []
    return this.security.listAudit(me.authUserId)
  }

  /* 🔴 「我是誰」**以當下的 session 為準**,而不是由租戶的 actor 反推。

     這一頁問的是「**這個登入的人**有哪些裝置」,session 就是那個問題的直接答案;
     繞經 actor 反查等於多一層可能對不上的對映。dev 尤其明顯:租戶由
     `x-dev-tenant` 決定、**刻意不觸 session**(OQ-AUTH-7),於是 actor 與實際登入者
     可以是兩個人 —— 清單就會整片空白(實測如此)。

     沒有 session 時(純 dev header 路徑)才退回 actor 對映,讓 dev 仍看得到東西。
     兩條路都不接受呼叫端指定使用者。 */
  private async whoami(
    tenant: TenantContext,
    request: FastifyRequest,
  ): Promise<{ authUserId: string | null; token: string | null }> {
    const session = await this.auth.api
      .getSession({ headers: fromNodeHeaders(request.headers) })
      .catch(() => null)
    if (session !== null) {
      return { authUserId: session.user.id, token: session.session.token }
    }
    return { authUserId: await this.identity.getAuthUserIdByActor(tenant.actorId), token: null }
  }
}
