import { Module } from "@nestjs/common"
import { DdlService } from "./ddl/ddl.service.js"
import { MetadataService } from "./metadata/metadata.service.js"
import { RecordService } from "./records/record.service.js"

@Module({
  providers: [MetadataService, DdlService, RecordService],
  exports: [MetadataService, DdlService, RecordService],
})
export class FormEngineModule {}
