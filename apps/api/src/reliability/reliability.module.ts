import { Module } from "@nestjs/common"
import { APP_INTERCEPTOR } from "@nestjs/core"
import { CleanupService } from "./cleanup.service.js"
import { IdempotencyInterceptor } from "./idempotency.interceptor.js"
import { QuotaService } from "./quota.service.js"

/* F-6 平台可靠性工程。收斂各模組 P1 殘留:冪等性 / 配額 / 清理 job。
   只依賴全域 DbModule(APP_KNEX);不 import 業務模組 → 可安全全域掛載。 */
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    QuotaService,
    CleanupService,
  ],
  exports: [QuotaService, CleanupService],
})
export class ReliabilityModule {}
