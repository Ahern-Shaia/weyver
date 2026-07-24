import { Controller, Get, Inject, UseGuards } from "@nestjs/common"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { AuthzRepository } from "./authz.repository.js"

/* R1·UP-1 分類清單唯讀端點(登入者可讀,TenantGuard 非 AdminGuard)。工作區 IA 目錄用。
   分類名對租戶內非機密;跨租戶由 tenant scope 擋。只回 id/name/position(不洩內部欄)。 */
@Controller("api/categories")
@UseGuards(TenantGuard)
export class CategoriesController {
  constructor(@Inject(AuthzRepository) private readonly repo: AuthzRepository) {}

  @Get()
  async list(
    @Tenant() tenant: TenantContext,
  ): Promise<Array<{ id: number; name: string; position: number }>> {
    const cats = await this.repo.listCategories(tenant.tenantId)
    return cats.map((c) => ({ id: c.id, name: c.name, position: c.position }))
  }
}
