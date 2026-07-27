import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { LabelsController } from "./labels.controller.js"
import { LabelsService } from "./labels.service.js"

/* R1·後續-2 標籤模組。依賴 FormEngineModule(MetadataService 驗欄名)+ AuthzModule(PermissionGuard)。 */
@Module({
  imports: [AuthzModule, FormEngineModule],
  controllers: [LabelsController],
  providers: [LabelsService],
  exports: [LabelsService],
})
export class LabelsModule {}
