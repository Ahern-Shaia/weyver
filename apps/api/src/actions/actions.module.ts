import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { ActionsRepository } from "./actions.repository.js"
import { ButtonService } from "./button.service.js"
import { ButtonsController } from "./buttons.controller.js"

/* R1·後續-1 按鈕 + 簽核模組。依賴 FormEngineModule(RecordService 執行副作用)+ AuthzModule(權限/角色)。 */
@Module({
  imports: [AuthzModule, FormEngineModule],
  controllers: [ButtonsController],
  providers: [ActionsRepository, ButtonService],
  exports: [ActionsRepository, ButtonService],
})
export class ActionsModule {}
