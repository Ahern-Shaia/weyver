import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { UsersLookupService } from "./users-lookup.service.js"

/* R1·workbench-uplift A5|actor id → 顯示名(稽核區用)。
   唯讀、tenant-scoped、只回 `{id,name}`;不掛 PermissionGuard —— 無 :formId 且非表單資源,
   租戶成員本就看得到彼此姓名(與 Ragic 一致);跨租戶隔離由 service 之 role_members join 保證。 */
@Controller("api/users")
@UseGuards(TenantGuard)
export class UsersLookupController {
  constructor(@Inject(UsersLookupService) private readonly users: UsersLookupService) {}

  @Get("lookup")
  async lookup(
    @Tenant() tenant: TenantContext,
    @Query("ids") ids?: string,
  ): Promise<{ id: number; name: string }[]> {
    const parsed = (ids ?? "")
      .split(",")
      .map((raw) => Number(raw.trim()))
      .filter((n) => Number.isSafeInteger(n) && n > 0)
    return this.users.lookup(tenant.tenantId, parsed)
  }
}
