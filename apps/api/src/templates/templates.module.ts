import { Module } from "@nestjs/common"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { TemplateService } from "./template.service.js"

/* R1·TPL 範本庫。只依賴 FormEngineModule 曝露的 DdlService —— 建表走既有引擎,
   本模組不碰動態 DDL(那是引擎的職責,也是最大的注入破口所在)。 */
@Module({
  imports: [FormEngineModule],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplatesModule {}
