import { Global, Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { ApiKeyService } from "./api-key.service.js"
import { EventFanoutService } from "./event-fanout.service.js"
import { EventService } from "./event.service.js"
import { IntegrationsController } from "./integrations.controller.js"
import { WebhookDeliveryService } from "./webhook-delivery.service.js"
import { WebhookService } from "./webhook.service.js"

/* G-1|對外接縫。`@Global()` 的理由與 NotificationsModule 同:
   `EventService` 需被 form-engine 注入為**旁路**呼叫,全域註冊避免反向相依
   (FormEngineModule 不該 import 本模組,否則 webhook → form-engine → webhook 成環)。

   本模組只依賴 DbModule 與 AuthzModule,不 import 任何業務模組。 */
@Global()
@Module({
  imports: [AuthzModule],
  controllers: [IntegrationsController],
  providers: [
    EventService,
    EventFanoutService,
    WebhookService,
    WebhookDeliveryService,
    ApiKeyService,
  ],
  exports: [
    EventService,
    EventFanoutService,
    WebhookService,
    WebhookDeliveryService,
    ApiKeyService,
  ],
})
export class IntegrationsModule {}
