import { Module } from "@nestjs/common"
import { AuthzRepository } from "./authz.repository.js"
import { PermissionService } from "./permission.service.js"

/* P0-4a authz。M1:資料存取 + 種子。M2:PermissionService(授權決策)。M3 PermissionGuard 後續加入。
   只依賴全域 DbModule(DRIZZLE);不 import AuthModule(避免循環 — 種子由 AuthModule 反向注入本 repo)。 */
@Module({
  providers: [AuthzRepository, PermissionService],
  exports: [AuthzRepository, PermissionService],
})
export class AuthzModule {}
