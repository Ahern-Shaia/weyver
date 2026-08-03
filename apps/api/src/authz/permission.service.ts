import { Inject, Injectable } from "@nestjs/common"
import {
  type EffectivePermissions,
  adminPermissions,
  buildEffectivePermissions,
} from "./authz-effective.js"
import { AuthzRepository } from "./authz.repository.js"

/* P0-4a M2 + uplift|授權決策服務。解析一名 actor 對某租戶的有效權限(deny-by-default)。
   admin 系統角色 → 全動作(不查每表)。否則分層解析:owner → 覆寫 → 分類繼承 → 預設 profile
   (docs/modules/R1/authz-resource-inheritance.md §5)。owner/預設可在無角色下授權 → 不因空角色早退。
   每請求解析一次由 PermissionGuard 呼叫並掛到 request(等同 per-request 快取;跨請求快取待 CLS,OQ-6)。 */
@Injectable()
export class PermissionService {
  constructor(@Inject(AuthzRepository) private readonly repo: AuthzRepository) {}

  async resolveForActor(tenantId: number, actorId: number): Promise<EffectivePermissions> {
    if (await this.repo.isAdminActor(tenantId, actorId)) {
      return adminPermissions()
    }
    const roleIds = await this.repo.resolveActorRoleIds(tenantId, actorId)
    // 注意:即使無角色,owner 短路 / 租戶預設 profile 仍可授權 → 不早退
    const [formRows, categoryRows, fieldRows, formMeta, defaultActions] = await Promise.all([
      this.repo.loadFormPermissions(roleIds),
      this.repo.loadCategoryPermissions(roleIds),
      this.repo.loadFieldPermissions(roleIds),
      this.repo.loadFormMeta(tenantId),
      this.repo.getTenantDefaultActions(tenantId),
    ])
    return buildEffectivePermissions({
      isAdmin: false,
      actorId,
      roleIds,
      formRows,
      categoryRows,
      fieldRows,
      formMeta,
      defaultActions,
    })
  }
}
