import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { AuthModule } from "./auth/auth.module.js"
import { AuthzModule } from "./authz/authz.module.js"
import { validateEnv } from "./config/env.js"
import { DbModule } from "./db/db.module.js"
import { FormEngineModule } from "./form-engine/form-engine.module.js"
import { HealthModule } from "./health/health.module.js"
import { DomainExceptionFilter } from "./http/domain-exception.filter.js"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // 全域速率限制(AGENTS 🔒:APP_GUARD)—— Nest 路由防護;/api/auth/* 另由 Better Auth rateLimit 覆蓋
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DbModule,
    AuthzModule,
    AuthModule,
    FormEngineModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
