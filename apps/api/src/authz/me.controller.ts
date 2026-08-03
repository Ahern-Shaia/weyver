import { Controller, Get, Inject, UseGuards } from "@nestjs/common"
import { TenantGuard } from "../auth/tenant.guard.js"
import type { TenantContext } from "../http/tenant-context.js"
import { Tenant } from "../http/tenant.decorator.js"
import { adminPermissions } from "./authz-effective.js"
import type { FormAction } from "./authz-model.js"
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
}

@Controller("api/authz")
@UseGuards(TenantGuard)
export class MeController {
  constructor(@Inject(PermissionService) private readonly permissions: PermissionService) {}

  @Get("me")
  async me(@Tenant() tenant: TenantContext): Promise<MyCapabilities> {
    const effective = tenant.isSuperAdmin
      ? adminPermissions()
      : await this.permissions.resolveForActor(tenant.tenantId, tenant.actorId)
    return { isAdmin: effective.isAdmin, forms: effective.toFormActionMap() }
  }
}
