import { Module } from "@nestjs/common"
import { DdlService } from "./ddl/ddl.service.js"
import { MetadataService } from "./metadata/metadata.service.js"

@Module({
  providers: [MetadataService, DdlService],
  exports: [MetadataService, DdlService],
})
export class FormEngineModule {}
