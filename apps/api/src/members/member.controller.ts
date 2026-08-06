import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  InternalServerErrorException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { z } from "zod"
import type { createAuth } from "../auth/auth.js"
import { AUTH } from "../auth/auth.tokens.js"
import { IdentityService } from "../auth/identity.service.js"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import type { CreatedMember, MemberRow } from "./member.service.js"
import { MemberService } from "./member.service.js"

/* R1·A-1 M2|使用者管理 API。

   **讀成員清單不限 admin**(指派簽核對象、看誰在公司裡都需要);
   **建立 / 停權限 admin** —— 那是租戶級的人事動作。

   🔴 建立成員刻意**沒有 password 入參**(ASVS §V6.4.6)。明文只在回應中出現一次,
   之後任何查詢都拿不到,也不進日誌。 */

const createSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).describe("成員 email"),
  name: z.string().trim().min(1).max(80),
})

const statusSchema = z.object({ status: z.enum(["active", "suspended"]) })

@Controller("api/members")
@UseGuards(TenantGuard, PermissionGuard)
export class MemberController {
  constructor(
    @Inject(MemberService) private readonly members: MemberService,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AUTH) private readonly auth: ReturnType<typeof createAuth>,
  ) {}

  @Get()
  async list(@Tenant() tenant: TenantContext): Promise<MemberRow[]> {
    const orgId = await this.identity.getOrgIdByTenant(tenant.tenantId)
    /* dev 種子租戶可能沒綁 org(tenants.auth_org_id nullable)—— 回空而非炸掉 */
    if (orgId === null) return []
    const actorIds = await this.identity.listMemberActorIds(orgId)
    return this.members.list(tenant.tenantId, actorIds)
  }

  /* 建帳號會寄出真實副作用(佔用 email、產生憑證)→ 比一般寫入更嚴的節流 */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ): Promise<CreatedMember> {
    requireAdmin(permissions)
    const orgId = await this.identity.getOrgIdByTenant(tenant.tenantId)
    if (orgId === null) {
      throw new InternalServerErrorException({
        code: "TENANT_NOT_LINKED",
        message: "此租戶尚未綁定組織,無法新增成員",
      })
    }

    return this.members.create({
      tenantId: tenant.tenantId,
      issuedByActorId: tenant.actorId,
      email: body.email,
      name: body.name,
      /* 密碼由服務層產生後交進來 —— controller 不經手、不記錄 */
      createAuthUser: async (email, name, password) => {
        const created = await this.auth.api.signUpEmail({ body: { email, name, password } })
        return created.user.id
      },
      /* `addMember` 是 `createAuthEndpoint.serverOnly()` —— org plugin 沒有
         add-member 的 HTTP 路由(只有 invite / accept),故只能由伺服器端呼叫。
         這正是我們要的:加人是後台動作,不該有對外端點。 */
      addToOrg: async (authUserId) => {
        await this.auth.api.addMember({
          body: { userId: authUserId, organizationId: orgId, role: "member" },
        })
      },
      /* 新人尚未登入過,JIT upsert 還沒跑過 → 這裡主動建 actor 列(冪等) */
      provisionActor: (authUserId, email, name) =>
        this.identity.upsertUser({ authUserId, email, name }),
    })
  }

  @Patch(":actorId/status")
  async setStatus(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Param("actorId", ParseIntPipe) actorId: number,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ): Promise<{ ok: true }> {
    requireAdmin(permissions)
    await this.members.setStatus(tenant.tenantId, actorId, body.status, tenant.actorId)
    return { ok: true }
  }
}

function requireAdmin(permissions: EffectivePermissions): void {
  if (!permissions.isAdmin) {
    throw new ForbiddenException({ code: "FORBIDDEN", message: "僅管理員可管理成員" })
  }
}
