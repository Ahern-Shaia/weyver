import { Global, Module } from "@nestjs/common"
import { ChannelConfigService } from "./channel-config.service.js"
import { ChannelSenderService } from "./channel-sender.service.js"
import { EmailChannel } from "./email.channel.js"
import { NotificationDispatcher } from "./notification-dispatcher.service.js"
import { NotificationRepository } from "./notification.repository.js"
import { NotificationService } from "./notification.service.js"
import { NotificationsController } from "./notifications.controller.js"

/* H-1 通知系統。`@Global()` 的理由與 F-8 BillingModule 同:
   `NotificationService` 需被多個業務模組(actions / form-engine)注入為**旁路**呼叫,
   走全域註冊避免每個業務模組都得 import 通知模組、也避免反向相依。

   本模組**只依賴 DbModule**,不 import 任何業務模組 → 可安全全域掛載,
   且不會造成 dependency-cruiser 的跨模組違規。 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationRepository,
    NotificationService,
    EmailChannel,
    NotificationDispatcher,
    /* 通道**發送**屬於通知核心(dispatcher 要用);通道**設定 API** 另在
       ChannelsModule —— 那一支需要 AuthzModule,不能放進 @Global 模組。 */
    ChannelConfigService,
    ChannelSenderService,
  ],
  exports: [
    NotificationService,
    NotificationRepository,
    NotificationDispatcher,
    ChannelConfigService,
    ChannelSenderService,
  ],
})
export class NotificationsModule {}
