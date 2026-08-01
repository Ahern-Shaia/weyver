import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { StorageModule } from "../storage/storage.module.js"
import { ExportRunnerService } from "./export-runner.service.js"
import { ExportWorkerService } from "./export-worker.service.js"
import { ExportRepository } from "./export.repository.js"
import { ExportService } from "./export.service.js"
import { ExportsController } from "./exports.controller.js"

/* R1·I-1 資料匯出。依賴 FormEngineModule(metadata / records)+ AuthzModule(逐表過權)
   + StorageModule(封存檔落地)。

   M1 刻意沒有 controller(匯出是「一次全拿」,端點在授權與限制齊備前不該存在);
   M2 掛上,此時逐表過權、每日上限、同時一個、節流、唯讀豁免均已就位。 */
@Module({
  imports: [AuthzModule, FormEngineModule, StorageModule],
  controllers: [ExportsController],
  providers: [ExportRepository, ExportService, ExportRunnerService, ExportWorkerService],
  exports: [ExportRepository, ExportService, ExportRunnerService, ExportWorkerService],
})
export class ExportModule {}
