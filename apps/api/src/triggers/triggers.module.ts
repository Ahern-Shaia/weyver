import { Module } from "@nestjs/common"

import { AuthzModule } from "../authz/authz.module.js"
import { DbModule } from "../db/db.module.js"
import { TriggerSyncService } from "./trigger-sync.service.js"
import { TriggerService } from "./trigger.service.js"
import { TriggersController } from "./triggers.controller.js"
import { TriggersRepository } from "./triggers.repository.js"

/* R1·C-4|事件觸發器。

   ⚠️ **本模組刻意不相依 `RecordService`**,而是反過來被它注入。
   相依方向若倒過來就是迴圈(`RecordService` → `TriggerSync` → `RecordService`),
   而同步側本來就不需要 —— 它只算值,不寫入。

   非同步側(`pushTo`,M3)要相依 `ButtonService`,故另置一個 service,
   由 outbox 消費者驅動,不進本模組的相依圖。 */
@Module({
  imports: [DbModule, AuthzModule],
  controllers: [TriggersController],
  providers: [TriggersRepository, TriggerSyncService, TriggerService],
  exports: [TriggersRepository, TriggerSyncService],
})
export class TriggersModule {}
