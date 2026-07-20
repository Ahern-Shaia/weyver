import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormsController } from "./api/forms.controller.js"
import { RecordsController } from "./api/records.controller.js"
import { DdlService } from "./ddl/ddl.service.js"
import { FormulaService } from "./formula/formula.service.js"
import { MetadataService } from "./metadata/metadata.service.js"
import { RecordService } from "./records/record.service.js"
import { RelationService } from "./relations/relation.service.js"
import { RollupService } from "./relations/rollup.service.js"

@Module({
  imports: [AuthzModule],
  controllers: [FormsController, RecordsController],
  providers: [
    MetadataService,
    DdlService,
    RecordService,
    FormulaService,
    RelationService,
    RollupService,
  ],
  exports: [
    MetadataService,
    DdlService,
    RecordService,
    FormulaService,
    RelationService,
    RollupService,
  ],
})
export class FormEngineModule {}
