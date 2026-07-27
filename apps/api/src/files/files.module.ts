import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FilesController, FormFilesController } from "./files.controller.js"
import { FilesService } from "./files.service.js"

/* F-5 檔案模組。StorageModule 為 @Global(driver token)→ 此處不需 import。
   **刻意不 import FormEngineModule**:反向由 FormEngineModule import 本模組,
   使 RecordService 可注入 FilesService 做兩階段綁定而無循環(AGENTS 禁 forwardRef)。 */
@Module({
  imports: [AuthzModule],
  controllers: [FormFilesController, FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
