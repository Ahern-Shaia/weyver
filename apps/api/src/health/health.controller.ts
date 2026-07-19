import { Controller, Get } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"

@Controller("health")
@SkipThrottle() // 健康檢查供 LB 高頻探測,不受全域速率限制
export class HealthController {
  @Get()
  health(): { ok: boolean } {
    return { ok: true }
  }
}
