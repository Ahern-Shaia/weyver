import { Global, Module } from "@nestjs/common"
import { EntitlementService } from "./entitlement.service.js"

/* F-8 計費地基。**只做不可延的三件事**(用量歷史 / 生命週期狀態 / entitlement 檢查點),
   金流 / 帳單 / 發票 / 催繳留待 docs/04 A7 之營運觸發條件(付費客戶 > 10 家)。

   `@Global()` 且**刻意只含 `EntitlementService`**:它被 `TenantGuard`(auth 模組)注入,
   而 auth 為橫切基礎設施 —— 走全域註冊避免 auth ↔ billing 相互 import。
   `UsageService` 需要 `DDL_KNEX`,若一併放進全域模組,會讓每個「只想測 auth」的
   測試模組圖都被迫提供 Knex。故拆為 `UsageModule`(非全域,僅 AppModule 掛載)。 */
@Global()
@Module({
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class BillingModule {}
