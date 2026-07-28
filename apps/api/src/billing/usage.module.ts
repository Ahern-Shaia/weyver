import { Module } from "@nestjs/common"
import { ScheduleModule } from "@nestjs/schedule"
import { UsageService } from "./usage.service.js"

/* F-8 M2 用量採集。與 `BillingModule` 分開的理由見該檔註解(相依 `DDL_KNEX`,不宜全域)。 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
