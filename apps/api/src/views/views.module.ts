import { Module } from "@nestjs/common"
import { AuthzModule } from "../authz/authz.module.js"
import { ViewRepository } from "./view.repository.js"
import { ViewService } from "./view.service.js"
import { ViewsController } from "./views.controller.js"

/* R1·UP-2 視圖模組。依賴全域 DbModule(DRIZZLE)+ AuthzModule(PermissionGuard / AuthzRepository)。 */
@Module({
  imports: [AuthzModule],
  controllers: [ViewsController],
  providers: [ViewService, ViewRepository],
})
export class ViewsModule {}
