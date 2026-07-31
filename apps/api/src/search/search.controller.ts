import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { EffectivePermissions } from "../authz/authz-effective.js"
import { Permissions } from "../authz/authz-http.js"
import { PermissionGuard } from "../authz/permission.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { ZodValidationPipe } from "../http/zod-validation.pipe.js"
import { SearchService, type SearchResult } from "./search.service.js"

/* R1·H-3 M3|跨表全文搜尋。

   不掛 `@RequiresFormAction` —— 本端點**跨表**,沒有單一 formId 可檢核;
   範圍限制改由 service 內的 `readableFormIds` pre-filter 執法(OQ-FTS-2=A)。 */

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

/* 路徑不含 `engine` —— web 的 rewrite 已把 `/api/engine/:path*` 映到本服務的
   `/api/:path*`(next.config.ts),寫成 `api/engine/search` 會變成 `/api/engine/engine/search`。 */
@Controller("api/search")
@UseGuards(TenantGuard, PermissionGuard)
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get()
  async query(
    @Tenant() tenant: TenantContext,
    @Permissions() permissions: EffectivePermissions,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: z.infer<typeof searchQuerySchema>,
  ): Promise<SearchResult> {
    return this.search.search(tenant.tenantId, query.q, permissions, query.limit ?? 50)
  }
}
