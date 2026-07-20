import { Inject, Injectable } from "@nestjs/common"
import { AuthzRepository } from "./authz.repository.js"
import { buildEffectivePermissions, type EffectivePermissions } from "./authz-effective.js"

/* P0-4a M2|授權決策服務。解析一名 actor 對某租戶的有效權限(deny-by-default)。
   admin 系統角色 → 全租戶 manage(不查每表);否則聚合角色閉包(自身+祖先)的權限列。
   每請求解析一次由 PermissionGuard 呼叫並掛到 request(M3),避免同請求重算(等同 per-request 快取,
   對齊現有 TenantContext 掛 req 之模式;nestjs-cls / Redis 跨請求快取待 CLS 基建落地,OQ-6)。 */
@Injectable()
export class PermissionService {
  constructor(@Inject(AuthzRepository) private readonly repo: AuthzRepository) {}

  async resolveForActor(tenantId: number, actorId: number): Promise<EffectivePermissions> {
    if (await this.repo.isAdminActor(tenantId, actorId)) {
      return buildEffectivePermissions(true, [], [])
    }
    const roleIds = await this.repo.resolveActorRoleIds(tenantId, actorId)
    if (roleIds.length === 0) {
      // 無角色 → deny-all(deny-by-default,OQ-4)
      return buildEffectivePermissions(false, [], [])
    }
    const [formRows, fieldRows] = await Promise.all([
      this.repo.loadFormPermissions(roleIds),
      this.repo.loadFieldPermissions(roleIds),
    ])
    return buildEffectivePermissions(false, formRows, fieldRows)
  }
}
