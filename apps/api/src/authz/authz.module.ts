import { Module } from "@nestjs/common"
import { AuthzRepository } from "./authz.repository.js"

/* P0-4a authz。M1:資料存取 + 種子。M2 PermissionService / M3 PermissionGuard 於後續里程碑加入並 export。
   只依賴全域 DbModule(DRIZZLE);不 import AuthModule(避免循環 — 種子由 AuthModule 反向注入本 repo)。 */
@Module({
  providers: [AuthzRepository],
  exports: [AuthzRepository],
})
export class AuthzModule {}
