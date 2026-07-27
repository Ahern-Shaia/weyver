import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { FilesController, FormFilesController } from "./files.controller.js"
import { FilesService } from "./files.service.js"

/* F-5 檔案模組。StorageModule 為 @Global(driver token)→ 此處不需 import。 */
@Module({
  imports: [AuthzModule, FormEngineModule],
  controllers: [FormFilesController, FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
