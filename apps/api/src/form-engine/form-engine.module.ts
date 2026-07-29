import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FilesModule } from "../files/files.module.js"
import { ReliabilityModule } from "../reliability/reliability.module.js"
import { FormsController } from "./api/forms.controller.js"
import { RecordsController } from "./api/records.controller.js"
import { DdlService } from "./ddl/ddl.service.js"
import { FormulaService } from "./formula/formula.service.js"
import { LayoutService } from "./layout/layout.service.js"
import { MetadataService } from "./metadata/metadata.service.js"
import { AccessPreviewService } from "./access/access-preview.service.js"
import { OptionService } from "./field-types/option.service.js"
import { ImportService } from "./import/import.service.js"
import { RecordService } from "./records/record.service.js"
import { RelationService } from "./relations/relation.service.js"
import { ReverseRelationService } from "./relations/reverse-relation.service.js"
import { RollupService } from "./relations/rollup.service.js"

@Module({
  // FilesModule 單向被 import(其自身不 import 本模組)→ RecordService 可注入 FilesService 綁定附件
  imports: [AuthzModule, FilesModule, ReliabilityModule],
  controllers: [FormsController, RecordsController],
  providers: [
    MetadataService,
    AccessPreviewService,
    DdlService,
    OptionService,
    ImportService,
    RecordService,
    FormulaService,
    RelationService,
    ReverseRelationService,
    RollupService,
    LayoutService,
  ],
  exports: [
    MetadataService,
    AccessPreviewService,
    DdlService,
    OptionService,
    ImportService,
    RecordService,
    FormulaService,
    RelationService,
    ReverseRelationService,
    RollupService,
    LayoutService,
  ],
})
export class FormEngineModule {}
