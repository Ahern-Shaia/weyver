import { Module } from "@nestjs/common"
import { FormsController } from "./api/forms.controller.js"
import { RecordsController } from "./api/records.controller.js"
import { DdlService } from "./ddl/ddl.service.js"
import { MetadataService } from "./metadata/metadata.service.js"
import { RecordService } from "./records/record.service.js"

@Module({
  controllers: [FormsController, RecordsController],
  providers: [MetadataService, DdlService, RecordService],
  exports: [MetadataService, DdlService, RecordService],
})
export class FormEngineModule {}
