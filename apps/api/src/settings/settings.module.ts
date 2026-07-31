import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { SettingsController } from "./settings.controller.js"
import { SettingsService } from "./settings.service.js"

/* R1·A-1|設定中心(S22)。不需 `@Global()` —— 沒有其他模組需要旁路注入它。 */
@Module({
  imports: [AuthzModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
