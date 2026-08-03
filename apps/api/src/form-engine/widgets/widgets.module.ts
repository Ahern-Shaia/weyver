import { Module } from "@nestjs/common"
import { AuthzModule } from "../../authz/authz.module.js"
import { FormEngineModule } from "../form-engine.module.js"
import { WidgetService } from "./widget.service.js"
import { WidgetsController } from "./widgets.controller.js"

/* F-2 M4 小圖表。依賴 FormEngineModule 的 MetadataService(欄位可見性)
   與 AuthzModule 的 AuthzRepository(角色 / 表單權限)—— 兩者都只讀。 */
@Module({
  imports: [FormEngineModule, AuthzModule],
  controllers: [WidgetsController],
  providers: [WidgetService],
  exports: [WidgetService],
})
export class WidgetsModule {}
