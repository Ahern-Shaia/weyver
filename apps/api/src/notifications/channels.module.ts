import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { ChannelConfigService } from "./channel-config.service.js"
import { ChannelSenderService } from "./channel-sender.service.js"
import { ChannelsController } from "./channels.controller.js"

/* R1·A-1 M4|通知通道連接。

   **刻意與 `NotificationsModule` 分開**:那一支是 `@Global()`,而它成立的前提是
   「只依賴 DbModule、不 import 任何業務模組」(見該檔註解)。
   本模組需要 `AuthzModule`(限管理員),塞進去就會破壞那個前提。

   語意上也站得住:通道**連接**是管理設定,通道**投遞**才是通知核心。 */
@Module({
  imports: [AuthzModule],
  controllers: [ChannelsController],
  providers: [ChannelConfigService, ChannelSenderService],
  exports: [ChannelConfigService],
})
export class ChannelsModule {}
