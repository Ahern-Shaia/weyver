import { Module } from "@nestjs/common"
import { AuthModule } from "../auth/auth.module.js"
import { SecurityController } from "./security.controller.js"
import { SecurityService } from "./security.service.js"

/* R1·A-1 M3|帳號安全。`SecurityService` 匯出供其他模組寫入認證稽核。 */
@Module({
  imports: [AuthModule],
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
