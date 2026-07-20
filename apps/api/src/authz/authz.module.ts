import { Module } from "@nestjs/common"
import { AuthzRepository } from "./authz.repository.js"
import { PermissionGuard } from "./permission.guard.js"
import { PermissionService } from "./permission.service.js"

/* P0-4a authz。M1:資料存取 + 種子。M2:PermissionService(授權決策)。M3:PermissionGuard(表單級)。
   只依賴全域 DbModule(DRIZZLE);不 import AuthModule(避免循環 — 種子由 AuthModule 反向注入本 repo)。
   consumer 模組(FormEngineModule)import 本模組即可 @UseGuards(PermissionGuard)。 */
@Module({
  providers: [AuthzRepository, PermissionService, PermissionGuard],
  exports: [AuthzRepository, PermissionService, PermissionGuard],
})
export class AuthzModule {}
