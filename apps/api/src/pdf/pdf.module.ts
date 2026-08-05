import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { SettingsModule } from "../settings/settings.module.js"
import { StorageModule } from "../storage/storage.module.js"
import { PDF_RENDERER } from "./pdf-renderer.js"
import { PdfWorkerService } from "./pdf-worker.service.js"
import { PdfController } from "./pdf.controller.js"
import { PdfRepository } from "./pdf.repository.js"
import { PdfService } from "./pdf.service.js"
import { PlaywrightPdfRenderer } from "./playwright-renderer.js"

/* R1·後續-2b|伺服器端 PDF。

   渲染器以 **token 注入**(`PDF_RENDERER`)—— OQ-PDF-2 要的「介面隔離」
   落在這裡:要抽成獨立服務時,換一個實作,呼叫端一行都不動。 */
@Module({
  imports: [AuthzModule, FormEngineModule, SettingsModule, StorageModule],
  controllers: [PdfController],
  providers: [
    PdfRepository,
    PdfService,
    PdfWorkerService,
    { provide: PDF_RENDERER, useClass: PlaywrightPdfRenderer },
  ],
  exports: [PdfService, PdfWorkerService],
})
export class PdfModule {}
