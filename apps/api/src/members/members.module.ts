import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { AuthzModule } from "../authz/authz.module.js"
import { MemberController } from "./member.controller.js"
import { MemberService } from "./member.service.js"

/* R1·A-1 M2|使用者管理。`MemberService` 匯出供 AuthGuard 查停權狀態。 */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [MemberController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MembersModule {}
