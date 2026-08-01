import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { StorageModule } from "../storage/storage.module.js"
import { ExportRunnerService } from "./export-runner.service.js"
import { ExportWorkerService } from "./export-worker.service.js"
import { ExportRepository } from "./export.repository.js"

/* R1·I-1 資料匯出。依賴 FormEngineModule(metadata / records)+ AuthzModule(逐表過權)
   + StorageModule(封存檔落地)。

   **本模組 M1 刻意沒有 controller** —— 匯出是「一次全拿」,端點在授權與頻率限制
   齊備之前不該存在。M2 才掛。 */
@Module({
  imports: [AuthzModule, FormEngineModule, StorageModule],
  providers: [ExportRepository, ExportRunnerService, ExportWorkerService],
  exports: [ExportRepository, ExportRunnerService, ExportWorkerService],
})
export class ExportModule {}
