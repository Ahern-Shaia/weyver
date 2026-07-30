import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core"
import { ScheduleModule } from "@nestjs/schedule"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { ActionsModule } from "./actions/actions.module.js"
import { ApprovalLockInterceptor } from "./actions/approval-lock.interceptor.js"
import { AuthModule } from "./auth/auth.module.js"
import { BillingModule } from "./billing/billing.module.js"
import { NotificationsModule } from "./notifications/notifications.module.js"
import { IntegrationsModule } from "./integrations/integrations.module.js"
import { PublicFormModule } from "./public-form/public-form.module.js"
import { UsageModule } from "./billing/usage.module.js"
import { AuthzModule } from "./authz/authz.module.js"
import { validateEnv } from "./config/env.js"
import { DbModule } from "./db/db.module.js"
import { FormEngineModule } from "./form-engine/form-engine.module.js"
import { HealthModule } from "./health/health.module.js"
import { FilesModule } from "./files/files.module.js"
import { ReliabilityModule } from "./reliability/reliability.module.js"
import { LabelsModule } from "./labels/labels.module.js"
import { StorageModule } from "./storage/storage.module.js"
import { DomainExceptionFilter } from "./http/domain-exception.filter.js"
import { ViewsModule } from "./views/views.module.js"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // 全域速率限制(AGENTS 🔒:APP_GUARD)—— Nest 路由防護;/api/auth/* 另由 Better Auth rateLimit 覆蓋
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    /* 🔴 排程只在此註冊一次(F-9 §4.1)。
       NestJS 10 以 deep-hash 去重 dynamic module,故過去三個 feature module 各自
       `ScheduleModule.forRoot()` 仍被合併成一個實例;**NestJS 11 改以物件參考判定**,
       同樣的寫法會變成三個獨立實例 → 每個 @Cron 跑三次(通知重複寄送、用量統計 ×3)。
       此為單元/整合測試結構上抓不到的失效,故以 `schedule-registration.test.ts` 斷言註冊次數。 */
    ScheduleModule.forRoot(),
    DbModule,
    /* F-8:@Global,須早於 AuthModule(TenantGuard 注入 EntitlementService)*/
    BillingModule,
    NotificationsModule,
    IntegrationsModule,
    PublicFormModule,
    UsageModule,
    StorageModule,
    AuthzModule,
    AuthModule,
    FormEngineModule,
    ViewsModule,
    ActionsModule,
    LabelsModule,
    FilesModule,
    ReliabilityModule,
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
