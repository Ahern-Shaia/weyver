import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { ActionsRepository } from "./actions.repository.js"
import { ApprovalDelegateRepository } from "./approval-delegate.repository.js"
import { ApprovalDelegateService } from "./approval-delegate.service.js"
import { ApprovalDelegatesController } from "./approval-delegates.controller.js"
import { ApprovalLockInterceptor } from "./approval-lock.interceptor.js"
import { ApprovalService } from "./approval.service.js"
import { ApprovalInboxController, ApprovalsController } from "./approvals.controller.js"
import { ButtonService } from "./button.service.js"
import { ButtonsController } from "./buttons.controller.js"

/* R1·後續-1 按鈕 + 簽核模組。依賴 FormEngineModule(RecordService 執行副作用)+ AuthzModule(權限/角色)。
   ApprovalLockInterceptor 由 AppModule 以 APP_INTERCEPTOR 註冊為全域(簽核中記錄拒改,FMEA A4)。 */
@Module({
  imports: [AuthzModule, FormEngineModule],
  controllers: [
    ButtonsController,
    ApprovalsController,
    ApprovalInboxController,
    ApprovalDelegatesController,
  ],
  providers: [
    ActionsRepository,
    ApprovalDelegateRepository,
    ApprovalDelegateService,
    ButtonService,
    ApprovalService,
    ApprovalLockInterceptor,
  ],
  exports: [ActionsRepository, ButtonService, ApprovalService, ApprovalLockInterceptor],
})
export class ActionsModule {}
