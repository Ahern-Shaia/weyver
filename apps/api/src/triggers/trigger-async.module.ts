import { Module } from "@nestjs/common"

import { AuthzModule } from "../authz/authz.module.js"
import { DbModule } from "../db/db.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { TriggerAsyncService } from "./trigger-async.service.js"
import { TriggersModule } from "./triggers.module.js"

/* 🔴 非同步側**另立一個模組**,不併進 `TriggersModule`。

   `FormEngineModule` 注入 `TriggerSyncService`,所以 `TriggersModule` 必須
   相依得比 `FormEngineModule` 淺;而非同步側要用 `RecordService`(建目標記錄),
   方向正好相反。併在一起就是模組級迴圈。

   分開後相依是一條直線:
   `TriggerAsyncModule` → `FormEngineModule` → `TriggersModule` → `DbModule`。 */
@Module({
  imports: [DbModule, AuthzModule, FormEngineModule, TriggersModule],
  providers: [TriggerAsyncService],
  exports: [TriggerAsyncService],
})
export class TriggerAsyncModule {}
