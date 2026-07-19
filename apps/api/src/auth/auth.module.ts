import { Global, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type pg from "pg"
import { DevTenantGuard } from "../http/dev-tenant.guard.js"
import { PG_POOL } from "../db/db.module.js"
import { AuthGuard } from "./auth-guard.js"
import { AUTH } from "./auth.tokens.js"
import { type Auth, createAuth } from "./auth.js"
import { IdentityService } from "./identity.service.js"
import { TenantGuard } from "./tenant.guard.js"

/* F-2|Better Auth 認證引擎 DI + 對映 + 租戶守衛。
   auth 表(user/account/session/organization/…)為 Tier-1 系統表,跨租戶且非 RLS → 特權 PG_POOL(OQ-AUTH-1/3)。
   org 建立 hook → IdentityService.ensureTenantForOrg(建 tenant + 連結,idempotent)。
   secret 由 ConfigService 注入(env schema 已驗;prod fail-fast),不散落 process.env。 */
@Global()
@Module({
  providers: [
    IdentityService,
    DevTenantGuard,
    AuthGuard,
    TenantGuard,
    {
      provide: AUTH,
      useFactory: (pool: pg.Pool, config: ConfigService, identity: IdentityService): Auth =>
        createAuth(pool, config.getOrThrow<string>("BETTER_AUTH_SECRET"), {
          baseURL: config.getOrThrow<string>("BETTER_AUTH_URL"),
          trustedOrigins: config
            .getOrThrow<string>("BETTER_AUTH_TRUSTED_ORIGINS")
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
          hooks: {
            onOrganizationCreated: (input): Promise<void> =>
              identity.ensureTenantForOrg(input).then(() => undefined),
          },
        }),
      inject: [PG_POOL, ConfigService, IdentityService],
    },
  ],
  exports: [AUTH, IdentityService, TenantGuard, AuthGuard, DevTenantGuard],
})
export class AuthModule {}
