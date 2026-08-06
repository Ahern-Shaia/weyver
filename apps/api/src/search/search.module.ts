import { Global, Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { FormEngineModule } from "../form-engine/form-engine.module.js"
import { SearchIndexService } from "./search-index.service.js"
import { SearchController } from "./search.controller.js"
import { SearchService } from "./search.service.js"

/* R1·H-3|跨表全文搜尋。

   `@Global()` 的理由與 IntegrationsModule 同:`SearchIndexService` 需被 form-engine
   的 RecordService 注入為**旁路**呼叫,全域註冊避免反向相依成環。

   ⚠️ `SearchIndexService` **無建構子依賴** —— 它一律在呼叫端的 tx 內寫入,
   拿不到自己的連線,因此不可能寫到別的 tx 去(這正是「同一個 tx」的結構性保證)。 */
@Global()
@Module({
  imports: [AuthzModule, FormEngineModule],
  controllers: [SearchController],
  providers: [SearchService, SearchIndexService],
  exports: [SearchService, SearchIndexService],
})
export class SearchModule {}
