import { Global, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type pg from "pg"
import { AuthzModule } from "../authz/authz.module.js"
import { AuthzRepository } from "../authz/authz.repository.js"
import { PG_POOL } from "../db/db.module.js"
import { DevTenantGuard } from "../http/dev-tenant.guard.js"
import { AuthGuard } from "./auth-guard.js"
import { type Auth, createAuth } from "./auth.js"
import { AUTH } from "./auth.tokens.js"
import { IdentityService } from "./identity.service.js"
import { TenantGuard } from "./tenant.guard.js"

/* F-2|Better Auth 認證引擎 DI + 對映 + 租戶守衛。
   auth 表(user/account/session/organization/…)為 Tier-1 系統表,跨租戶且非 RLS → 特權 PG_POOL(OQ-AUTH-1/3)。
   org 建立 hook → IdentityService.ensureTenantForOrg(建 tenant + 連結,idempotent)。
   secret 由 ConfigService 注入(env schema 已驗;prod fail-fast),不散落 process.env。 */
@Global()
@Module({
  imports: [AuthzModule],
  providers: [
    IdentityService,
    DevTenantGuard,
    AuthGuard,
    TenantGuard,
    {
      provide: AUTH,
      useFactory: (
        pool: pg.Pool,
        config: ConfigService,
        identity: IdentityService,
        authz: AuthzRepository,
      ): Auth =>
        createAuth(pool, config.getOrThrow<string>("BETTER_AUTH_SECRET"), {
          baseURL: config.getOrThrow<string>("BETTER_AUTH_URL"),
          trustedOrigins: config
            .getOrThrow<string>("BETTER_AUTH_TRUSTED_ORIGINS")
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
          hooks: {
            // org 建立 → 建 tenant(idempotent)→ 種入系統角色 → owner 對映 tenant admin(OQ-5)。全 idempotent。
            onOrganizationCreated: async (input): Promise<void> => {
              const tenantId = await identity.ensureTenantForOrg(input)
              await authz.seedSystemRoles(tenantId)
              const ownerActorId = await identity.upsertUser(input.owner)
              await authz.assignActorToSystemRole(tenantId, "admin", ownerActorId)
            },
          },
        }),
      inject: [PG_POOL, ConfigService, IdentityService, AuthzRepository],
    },
  ],
  exports: [AUTH, IdentityService, TenantGuard, AuthGuard, DevTenantGuard],
})
export class AuthModule {}
