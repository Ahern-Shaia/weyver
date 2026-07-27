import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { ActionsModule } from "./actions/actions.module.js"
import { ApprovalLockInterceptor } from "./actions/approval-lock.interceptor.js"
import { AuthModule } from "./auth/auth.module.js"
import { AuthzModule } from "./authz/authz.module.js"
import { validateEnv } from "./config/env.js"
import { DbModule } from "./db/db.module.js"
import { FormEngineModule } from "./form-engine/form-engine.module.js"
import { HealthModule } from "./health/health.module.js"
import { LabelsModule } from "./labels/labels.module.js"
import { StorageModule } from "./storage/storage.module.js"
import { DomainExceptionFilter } from "./http/domain-exception.filter.js"
import { ViewsModule } from "./views/views.module.js"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // 全域速率限制(AGENTS 🔒:APP_GUARD)—— Nest 路由防護;/api/auth/* 另由 Better Auth rateLimit 覆蓋
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DbModule,
    StorageModule,
    AuthzModule,
    AuthModule,
    FormEngineModule,
    ViewsModule,
    ActionsModule,
    LabelsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // R1·後續-1:簽核中記錄拒改(全域 interceptor;guards 之後執行 → 取得可信租戶)
    { provide: APP_INTERCEPTOR, useClass: ApprovalLockInterceptor },
  ],
})
export class AppModule {}
