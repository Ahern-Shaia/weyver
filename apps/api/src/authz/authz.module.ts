import { Module } from "@nestjs/common"
import { AdminGuard } from "./admin.guard.js"
import { AuthzAdminController } from "./authz-admin.controller.js"
import { AuthzAdminService } from "./authz-admin.service.js"
import { AuthzResourceController } from "./authz-resource.controller.js"
import { AuthzRepository } from "./authz.repository.js"
import { CategoriesController } from "./categories.controller.js"
import { PermissionGuard } from "./permission.guard.js"
import { PermissionService } from "./permission.service.js"

/* P0-4a authz。M1:資料存取 + 種子。M2:PermissionService。M3:PermissionGuard。M5:權限管理後台 API。
   只依賴全域 DbModule(DRIZZLE)+ 全域 AuthModule 之 TenantGuard;不 import AuthModule(避免循環 —
   種子由 AuthModule 反向注入本 repo)。consumer(FormEngineModule)import 本模組即可 @UseGuards(PermissionGuard)。 */
@Module({
  controllers: [AuthzAdminController, AuthzResourceController, CategoriesController],
  providers: [AuthzRepository, PermissionService, PermissionGuard, AdminGuard, AuthzAdminService],
  exports: [AuthzRepository, PermissionService, PermissionGuard],
})
export class AuthzModule {}
