import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { PublicFormAdminController } from "./public-form-admin.controller.js"
import { PublicFormController } from "./public-form.controller.js"
import { PublicFormService } from "./public-form.service.js"

/* G-2|公開表單。import FormEngineModule 取 RecordService(promote 時建立記錄)。
   本模組不被任何業務模組 import → 不會成環,故不需 @Global()。 */
@Module({
  imports: [AuthzModule, FormEngineModule],
  controllers: [PublicFormController, PublicFormAdminController],
  providers: [PublicFormService],
  exports: [PublicFormService],
})
export class PublicFormModule {}
