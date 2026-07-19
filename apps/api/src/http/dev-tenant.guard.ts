import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { Inject } from "@nestjs/common"
import type { FastifyRequest } from "fastify"

export interface TenantContext {
  readonly tenantId: number
  readonly actorId: number
}

export type RequestWithTenant = FastifyRequest & { tenantContext?: TenantContext }

/* ⚠️ F-2(Better Auth + JWT)前的開發期 stub:
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
    request.tenantContext = {
      tenantId,
      actorId: Number.isSafeInteger(actorId) && actorId > 0 ? actorId : 1,
    }
    return true
  }
}
