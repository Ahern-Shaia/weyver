import { Controller, Get, Inject, UseGuards } from "@nestjs/common"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { adminPermissions } from "./authz-effective.js"
import type { FormAction } from "./authz-model.js"
import { AuthzRepository } from "./authz.repository.js"
import { PermissionService } from "./permission.service.js"

/* 🔴 `/api/authz/me`|**前端唯一的能力來源**(OQ-ARI-9 / views-list P1 殘留 / docs/33 IA 第二階段)。

   在此之前前端**沒有任何能力來源** —— `form-workspace.tsx` 的 `canDesign` 是**寫死 `true`**,
   同檔的 `isAdmin` 也是。後端有執法(按下去會拿 403),但**畫面說謊**:
   使用者看得到他按不動的入口。

   這直接讓一個已經可行的功能形同不存在:分類層授 `design`(OQ-ARI-9)
   在後端早就生效,但被授權的人在畫面上仍看不到設計入口 —— 除非他去猜 URL。

   **只回「能做什麼」,不回「為什麼」** —— 前端不需要知道權限是繼承來的還是覆寫來的,
   而少回一層就少一個洩漏組織結構的面(§OQ-ARI-8 敏感表恆隱藏之同源考量)。 */
export interface MyCapabilities {
  readonly isAdmin: boolean
  /* key = formId(字串,JSON 物件鍵);值為該表可執行的動作 */
  readonly forms: Record<string, readonly FormAction[]>
  /* 🔴 R1·UP-3b v1.4|條件式格式的「登入使用者 / 群組」條件要用(`$actor` 虛擬欄位)。

     ⚠️ **這只給畫面用**。伺服器強制的那一半(條件式必填)在後端自己解析
     actor,不吃 client 的任何東西 —— 否則「只有主管才必填」的規則,
     打 API 的人自己說他是主管就繞過去了。

     ⚠️ 回的是**角色 id 不是名稱**:名稱會改,而規則存的是 id;
     且 id 對不知道組織結構的人不透露任何東西。 */
  readonly actorId: number
  readonly groupIds: readonly number[]
}

@Controller("api/authz")
@UseGuards(TenantGuard)
export class MeController {
  constructor(
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(AuthzRepository) private readonly repo: AuthzRepository,
  ) {}

  @Get("me")
  async me(@Tenant() tenant: TenantContext): Promise<MyCapabilities> {
    const effective = tenant.isSuperAdmin
      ? adminPermissions()
      : await this.permissions.resolveForActor(tenant.tenantId, tenant.actorId)
    /* superadmin(dev 車道)沒有真實角色 → 空群組。不是錯,是那條車道沒有身分。 */
    const groupIds = tenant.isSuperAdmin
      ? []
      : await this.repo.resolveActorRoleIds(tenant.tenantId, tenant.actorId)
    return {
      isAdmin: effective.isAdmin,
      forms: effective.toFormActionMap(),
      actorId: tenant.actorId,
      groupIds,
    }
  }
}
