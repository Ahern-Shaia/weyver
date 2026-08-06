import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { DbModule } from "../db/db.module.js"
import { AiConfigService } from "./ai-config.service.js"
import { AiController } from "./ai.controller.js"

/* R1·AI-1|AI 設定與 provider 層。
   刻意獨立於 `SettingsModule` —— AI 設定會長出 provider 呼叫、用量、
   提案器,那些與「公司資料 / 時區」不是同一個 bounded context。 */
@Module({
  imports: [DbModule, AuthzModule],
  controllers: [AiController],
  providers: [AiConfigService],
  exports: [AiConfigService],
})
export class AiModule {}
