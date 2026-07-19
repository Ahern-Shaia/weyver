import { Global, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import type pg from "pg"
import { PG_POOL } from "../db/db.module.js"
import { type Auth, createAuth } from "./auth.js"

export const AUTH = Symbol("AUTH")

/* F-2 M1|把 Better Auth 認證引擎(src/auth/auth.ts)DI 接進 NestJS。
   auth 表(user/account/session/organization/member/…)為 Tier-1 系統表,跨租戶且非 RLS 範疇
   → 用特權 PG_POOL(與 metadata 同庫,交易一致;OQ-AUTH-1/3)。
   secret 由 ConfigService 注入(env.ts schema 已驗;prod fail-fast),不散落 process.env(AGENTS Config)。
   handler 掛載(/api/auth/*)+ AuthGuard(getSession → tenantContext)= M3。 */
@Global()
@Module({
  providers: [
    {
      provide: AUTH,
      useFactory: (pool: pg.Pool, config: ConfigService): Auth =>
        createAuth(pool, config.getOrThrow<string>("BETTER_AUTH_SECRET")),
      inject: [PG_POOL, ConfigService],
    },
  ],
  exports: [AUTH],
})
export class AuthModule {}
